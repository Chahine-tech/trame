#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Project } from "ts-morph"
import { buildGraph } from "./graph.js"
import { evaluateRules } from "./rules.js"
import { ConfigError, loadConfig } from "./config.js"
import { findCycles, findOrphans } from "./analysis.js"
import { diagnose, type Finding } from "./doctor.js"
import { blameFindings } from "./blame.js"
import { disagreements, findCommunities } from "./communities.js"
import { diffGraphs } from "./diff.js"
import { toDot, toMarkdown, toMermaid } from "./export.js"
import { serve } from "./serve.js"
import { atCommit, buildTimeline, forEachCommit, listCommits, sampleCommits, type Commit } from "./replay.js"
import type { GraphData, TrameConfig, Violation } from "./types.js"

interface Args {
  command: "parse" | "check" | "doctor" | "blame" | "modules" | "watch" | "serve" | "diff" | "replay"
  src: string
  out: string
  tsconfig?: string
  noTsconfig: boolean
  /** drop the absolute source root, for a graph meant to be published */
  anonymous: boolean
  config?: string
  project?: string
  exclude: string[]
  data: string
  port: number
  dist?: string
  base?: string
  head?: string
  format: "json" | "mermaid" | "dot" | "markdown"
  since: string
  maxFrames: number
  repo: string
}

/**
 * Command-line exclusions plus whatever the config adds. The flag is the escape
 * hatch for a one-off run; the config is where a project states once which of
 * its folders are not architecture.
 */
function resolveExclude(args: Args, config: TrameConfig | null): string[] {
  return config?.exclude ? [...args.exclude, ...config.exclude] : args.exclude
}

/** Serialize the graph in whichever shape the caller asked for. */
function render(graph: GraphData, format: Args["format"]): string {
  if (format === "mermaid") return toMermaid(graph)
  if (format === "dot") return toDot(graph)
  if (format === "markdown") return toMarkdown(graph)
  return JSON.stringify(graph, null, 2)
}

/** Default output name follows the format unless the caller set one. */
function defaultOut(format: Args["format"]): string {
  if (format === "mermaid") return "trame.mmd"
  if (format === "dot") return "trame.dot"
  if (format === "markdown") return "trame.md"
  return "trame.json"
}

const FORMATS = ["json", "mermaid", "dot", "markdown"] as const

/**
 * Where the built viewer lives, which differs between the two ways trame runs.
 * Installed from npm it ships inside the package beside dist/; in this
 * repository it is another workspace two levels up. The bundled copy is checked
 * first so a published install never reaches for a monorepo path. An explicit
 * --dist always wins.
 */
function viewerDist(override: string | undefined): string {
  if (override) return path.resolve(override)
  const bundled = path.resolve(import.meta.dirname, "../viewer")
  if (fs.existsSync(path.join(bundled, "index.html"))) return bundled
  return path.resolve(import.meta.dirname, "../../viewer/dist")
}

const DEFAULT_EXCLUDE = ["node_modules", "dist", ".test.", ".spec.", ".stories.", "__tests__", "__mocks__"]

const HELP = `trame — parse a TypeScript/React codebase into a 3D architecture graph

  trame --src ./src [--out ./trame.json]     parse and write the graph
  trame check --src ./src                      evaluate rules, exit 1 on violations
  trame doctor --src ./src                     what to fix, worst first
  trame blame --src ./src [--since]            which commit introduced each problem
  trame modules --src ./src                    where the real module boundaries are
  trame watch --src ./src [--out ...]          re-parse on file changes
  trame serve --data ./trame.json [--port]   serve the built viewer
  trame diff --base a.json --head b.json       what a branch did to the architecture
  trame replay --src ./src [--since --max-frames]  how the architecture grew, across git history

  options:
    --tsconfig ./tsconfig.json   resolve path aliases through a specific tsconfig
    --no-tsconfig                ignore the tsconfig found next to --src
    --anonymous                  omit the source root — for a graph you publish
    --config ./trame.config.ts constraint rules (auto-detected in cwd)
    --project name               project name in meta
    --exclude a,b,c              extra path patterns to skip
    --format json|mermaid|dot|markdown   output shape (default json)
    --data ./trame.json        (serve) graph file to serve
    --port 3000                  (serve) port
    --dist ./path                (serve) viewer build override
    --since "6 months ago"       (replay) how far back to walk
    --max-frames 40              (replay) frame budget — the stride follows from it
    --repo .                     (replay) repository root

  Mermaid renders natively in GitHub issues, PRs and READMEs:
    trame --src ./src --format mermaid --out docs/architecture.mmd`

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "parse",
    src: "",
    out: "", // resolved from --format below unless the caller sets one
    exclude: [...DEFAULT_EXCLUDE],
    data: "trame.json",
    port: 3000,
    format: "json",
    since: "1 year ago",
    maxFrames: 40,
    repo: ".",
    noTsconfig: false,
    anonymous: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i] ?? ""
    switch (a) {
      case "check":
      case "doctor":
      case "blame":
      case "modules":
      case "watch":
      case "serve":
      case "diff":
      case "replay":
        args.command = a
        break
      case "--since":
        args.since = next()
        break
      case "--max-frames":
        args.maxFrames = Math.max(2, Number(next()) || 40)
        break
      case "--repo":
        args.repo = next()
        break
      case "--base":
        args.base = next()
        break
      case "--head":
        args.head = next()
        break
      case "--data":
        args.data = next()
        break
      case "--port":
        args.port = Number(next()) || 3000
        break
      case "--dist":
        args.dist = next()
        break
      case "--format": {
        const value = next() as Args["format"]
        if (!FORMATS.includes(value)) {
          console.error(`error: --format must be one of ${FORMATS.join(", ")} (got "${value}")`)
          process.exit(1)
        }
        args.format = value
        break
      }
      case "--src":
        args.src = next()
        break
      case "--out":
        args.out = next()
        break
      case "--anonymous":
        args.anonymous = true
        break
      case "--no-tsconfig":
        args.noTsconfig = true
        break
      case "--tsconfig":
        args.tsconfig = next()
        break
      case "--config":
        args.config = next()
        break
      case "--project":
        args.project = next()
        break
      case "--exclude":
        args.exclude.push(...next().split(",").filter(Boolean))
        break
      case "--help":
      case "-h":
        console.log(HELP)
        process.exit(0)
    }
  }
  if (!args.out) args.out = defaultOut(args.format)
  if (!args.src && args.command !== "serve" && args.command !== "diff") {
    console.error("error: --src <dir> is required (try --help)")
    process.exit(1)
  }
  return args
}

/**
 * The nearest tsconfig.json at or above the source root.
 *
 * Without one every `@/thing` import resolves to nothing, which is how most
 * React projects have been written since roughly 2022, so the default run
 * produced a graph with no edges and reported success. Measured on one ordinary
 * portfolio: 1 edge and 13 orphans out of 19 files, against 19 edges and 1
 * orphan with the flag.
 *
 * Found rather than required: the first run has to be right without a flag.
 */
function findTsconfig(from: string): string | undefined {
  let dir = from
  for (;;) {
    const candidate = path.join(dir, "tsconfig.json")
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Every .ts/.tsx under a root, pruning excluded directories before entering.
 *
 * The glob used to go straight to ts-morph with the exclusions applied to the
 * result, so pointing --src at a repository root walked node_modules in full: a
 * 4 GB heap and a fatal out-of-memory crash before a line of the codebase was
 * read. Negative globs do not help, because the traversal itself is what dies.
 * The decision has to be about the directory, not the files inside it.
 */
function sourceFilesUnder(root: string, exclude: string[]): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory: skipped, not fatal
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (exclude.some((pattern) => full.includes(pattern))) continue
      // real directories only: following symlinks invites a loop
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) found.push(full)
    }
  }
  walk(root)
  return found
}

/**
 * Warn when a workspace monorepo has not been installed.
 *
 * Packages like `@scope/thing` resolve through the symlinks `install` puts in
 * node_modules, not through tsconfig paths: cal.com maps `~/*` and
 * `@components/*` in its tsconfig and leaves `@calcom/*` to the workspace.
 * Without node_modules nothing can resolve those, `tsc` included, and the graph
 * comes out as one island per package: on cal.com, 200 cross-package edges
 * where there should be thousands.
 */
function warnIfUninstalledWorkspace(srcRoot: string): void {
  let dir = srcRoot
  for (;;) {
    const pkg = path.join(dir, "package.json")
    const isWorkspace =
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      (fs.existsSync(pkg) && Boolean(JSON.parse(fs.readFileSync(pkg, "utf8")).workspaces))
    if (isWorkspace) {
      if (!fs.existsSync(path.join(dir, "node_modules"))) {
        console.warn(
          `  \x1b[33m!\x1b[0m workspace monorepo with no node_modules — imports between packages will not resolve,
` +
            `    and each package will look like an island. Run your package manager's install first.`,
        )
      }
      return
    }
    const parent = path.dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

/**
 * `quiet` for parses the user did not ask for. Reading history parses a
 * throwaway checkout over and over, and each announced the tsconfig it found
 * inside a temp directory: sixteen lines of noise around three answers.
 */
function parseOnce(
  args: Args,
  srcRoot: string,
  exclude: string[] = args.exclude,
  quiet = false,
): GraphData {
  if (!quiet) warnIfUninstalledWorkspace(srcRoot)
  const tsconfig = args.noTsconfig
    ? undefined
    : args.tsconfig
      ? path.resolve(args.tsconfig)
      : findTsconfig(srcRoot)

  // said out loud: silent resolution is how the missing one went unnoticed
  if (tsconfig && !args.tsconfig) {
    if (!quiet) console.log(`  tsconfig: ${path.relative(process.cwd(), tsconfig) || tsconfig}`)
  }

  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: false, jsx: 4 /* react-jsx */ } })

  project.addSourceFilesAtPaths(sourceFilesUnder(srcRoot, exclude))

  const projectName = args.project ?? path.basename(path.dirname(srcRoot))
  const graph = buildGraph(project, srcRoot, projectName)
  graph.analysis = { orphans: findOrphans(graph), cycles: findCycles(graph) }

  /**
   * A published graph should not describe the machine that made it. Node paths
   * are already relative, so the source root is the one absolute thing left.
   * Dropping it costs only the jump-to-editor button, which could never have
   * worked on a stranger's machine.
   */
  if (args.anonymous) delete graph.meta.root

  return graph
}

function printViolations(violations: Violation[]): void {
  for (const v of violations) {
    console.log(`  \x1b[31m✗\x1b[0m [${v.rule}] ${v.message}`)
  }
}

function summarize(graph: GraphData, outPath: string, ms: number): void {
  const byType = new Map<string, number>()
  for (const n of graph.nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1)
  const typeSummary = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t} ${c}`)
    .join(" · ")
  const vCount = graph.violations?.length ?? 0
  const orphans = graph.analysis?.orphans.length ?? 0
  const cycles = graph.analysis?.cycles.length ?? 0
  console.log(
    `trame · ${graph.meta.project}\n` +
      `  ${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} edges · ${graph.clusters.length} folders` +
      (vCount ? ` · \x1b[31m${vCount} violations\x1b[0m` : "") +
      `\n  ${typeSummary}` +
      (orphans || cycles
        ? `\n  \x1b[33m${orphans} orphans · ${cycles} cycles\x1b[0m`
        : "") +
      `\n  → ${outPath} (${ms}ms)`,
  )
  if (graph.violations?.length) printViolations(graph.violations)
}

async function runParse(args: Args, srcRoot: string, quiet = false): Promise<GraphData> {
  const started = Date.now()
  const config = await loadConfig(args.config)
  const graph = parseOnce(args, srcRoot, resolveExclude(args, config))
  if (config) {
    graph.violations = evaluateRules(graph, config)
    graph.rules = config.rules
  }

  const outPath = path.resolve(args.out)
  fs.writeFileSync(outPath, render(graph, args.format))
  if (!quiet) summarize(graph, outPath, Date.now() - started)
  return graph
}

/**
 * Advice, not a gate. `check` exits 1 so CI can refuse a merge; this always
 * exits 0, because a command that fails a build over a suggestion gets turned
 * off.
 */
/**
 * Where the module boundaries actually are. Finds the groups of files that
 * depend on each other far more than on anything else, then reports only where
 * that disagrees with the folder tree.
 */
async function runModules(args: Args, srcRoot: string): Promise<void> {
  const config = await loadConfig(args.config)
  const graph = parseOnce(args, srcRoot, resolveExclude(args, config))
  const found = findCommunities(graph)
  const { split, merged } = disagreements(graph, found)

  const short = (id: string) => id.split("/").pop()!.replace(/\.[jt]sx?$/, "")
  // above roughly 0.3 the grouping explains the graph; near 0 it does not
  console.log(
    `  structure found: \x1b[1m${found.quality.toFixed(3)}\x1b[0m · your folders: \x1b[1m${found.folderQuality.toFixed(3)}\x1b[0m  \x1b[90m(0.3+ means the grouping explains the imports)\x1b[0m\n`,
  )

  // negative modularity is not "a bit low": it means files sharing a folder
  // are less connected than they would be if you had shuffled them, which is
  // the strongest thing this can find and deserves saying outright
  if (found.folderQuality < 0) {
    console.log(
      `  \x1b[33m!\x1b[0m grouping by folder is worse than grouping at random — the tree and the imports are unrelated\n`,
    )
  }

  if (split.length === 0 && merged.length === 0) {
    console.log(`  \x1b[32m✓\x1b[0m your folders and your dependencies agree`)
    return
  }

  for (const s of split) {
    console.log(`  \x1b[33m${s.folder}/\x1b[0m holds ${s.parts.length} groups that barely touch:`)
    for (const part of s.parts) {
      // enough to recognise the group, not the whole census
      const head = part.slice(0, 6).map(short).join(", ")
      const more = part.length > 6 ? ` … +${part.length - 6}` : ""
      console.log(`    \x1b[90m· ${head}${more}\x1b[0m`)
    }
    console.log()
  }
  for (const m of merged) {
    console.log(
      `  \x1b[33m${m.folders.join(" + ")}\x1b[0m are one module in practice \x1b[90m(${m.files.length} files)\x1b[0m\n`,
    )
  }
}

/**
 * Which commit introduced each problem, and who wrote it.
 *
 * Bisection over the full history rather than the sampled list a replay uses:
 * probing log₂(n) commits means precision costs nothing, so thinning the list
 * first would only make the answer vaguer for no saving. Parses are memoised
 * by sha because separate searches converge on the same midpoints.
 */
async function runBlame(args: Args, srcRoot: string): Promise<void> {
  const repo = path.resolve(args.repo)
  const commits = listCommits(repo, args.since)
  if (commits.length === 0) {
    console.error(`error: no commits since ${args.since} — try --since "5 years ago"`)
    process.exit(1)
  }

  const config = await loadConfig(args.config)
  const exclude = resolveExclude(args, config)
  const today = parseOnce(args, srcRoot, exclude)
  if (config) today.violations = evaluateRules(today, config)

  const relSrc = path.relative(repo, srcRoot)
  const cache = new Map<string, GraphData | null>()
  let checkouts = 0
  const graphAt = (commit: Commit): GraphData | null => {
    const hit = cache.get(commit.sha)
    if (hit !== undefined) return hit
    checkouts++
    // only when someone is watching: piped to a file, carriage returns are
    // litter rather than animation
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  reading history · ${checkouts} checkouts   `)
    }
    const graph = atCommit(repo, commit, (root) => {
      const at = path.join(root, relSrc)
      return fs.existsSync(at) ? parseOnce({ ...args, src: at }, at, exclude, true) : null
    })
    cache.set(commit.sha, graph)
    return graph
  }

  const label = (id: string) => today.nodes.find((n) => n.id === id)?.label ?? id
  const blamed = blameFindings(today, commits, graphAt, config, label)
  if (process.stdout.isTTY) process.stdout.write("\r".padEnd(48) + "\r")

  if (blamed.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m nothing to blame — no cycles, no rule broken`)
    return
  }

  console.log(`${blamed.length} traced through ${commits.length} commits, ${checkouts} read:\n`)
  for (const b of blamed) {
    console.log(`  ${b.what}`)
    if (b.commit) {
      console.log(
        `    \x1b[90m${b.commit.sha.slice(0, 8)} · ${b.commit.subject} · ${b.commit.author} · ${b.commit.date.slice(0, 10)}\x1b[0m\n`,
      )
    } else {
      console.log(`    \x1b[90molder than the history read — try --since\x1b[0m\n`)
    }
  }
}

async function runDoctor(args: Args, srcRoot: string): Promise<void> {
  const config = await loadConfig(args.config)
  const graph = parseOnce(args, srcRoot, resolveExclude(args, config))
  if (config) graph.violations = evaluateRules(graph, config)

  const findings = diagnose(graph)
  if (findings.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m nothing to fix — no cycles, no dead code, no rule broken`)
    return
  }

  const ICON: Record<Finding["kind"], string> = {
    cycle: "\x1b[33m⟳\x1b[0m",
    orphan: "\x1b[90m○\x1b[0m",
    violation: "\x1b[31m✗\x1b[0m",
  }
  /**
   * On a real 412-file project this produced 104 items. The ranking exists so
   * the tail can be left out; the count is still reported, so nothing is
   * hidden.
   */
  const SHOWN = 12
  const shown = findings.slice(0, SHOWN)
  const rest = findings.length - shown.length
  console.log(
    `${findings.length} thing${findings.length > 1 ? "s" : ""} worth fixing${rest > 0 ? `, top ${SHOWN}` : ""}:\n`,
  )
  for (const f of shown) {
    console.log(`  ${ICON[f.kind]} ${f.title}`)
    console.log(`    \x1b[90m→ ${f.fix}\x1b[0m\n`)
  }
  if (rest > 0) console.log(`  \x1b[90m… and ${rest} more, lower impact\x1b[0m`)
}

async function runCheck(args: Args, srcRoot: string): Promise<void> {
  const config = await loadConfig(args.config)
  const graph = parseOnce(args, srcRoot, resolveExclude(args, config))
  if (!config?.rules?.length) {
    console.error("error: no rules found — create trame.config.ts or pass --config")
    process.exit(1)
  }
  const violations = evaluateRules(graph, config)
  if (violations.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m ${config.rules.length} rules · 0 violations`)
    return
  }
  console.log(`${violations.length} violation${violations.length > 1 ? "s" : ""}:`)
  printViolations(violations)
  process.exit(1)
}

async function runWatch(args: Args, srcRoot: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let lastGood: GraphData | null = null

  const rebuild = async () => {
    if (running) return
    running = true
    const started = Date.now()
    try {
      const graph = await runParse(args, srcRoot, true)
      lastGood = graph
      const vCount = graph.violations?.length ?? 0
      console.log(
        `  ↻ ${new Date().toLocaleTimeString()} · ${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} edges` +
          (vCount ? ` · \x1b[31m${vCount} violations\x1b[0m` : "") +
          ` (${Date.now() - started}ms)`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ parse failed: ${message}`)
      // republish the last good graph flagged as stale, so the viewer can say
      // so instead of showing an out-of-date architecture as if it were current
      if (lastGood) {
        const stale: GraphData = {
          ...lastGood,
          meta: { ...lastGood.meta, generated: new Date().toISOString(), error: message },
        }
        fs.writeFileSync(path.resolve(args.out), render(stale, args.format))
      }
    } finally {
      running = false
    }
  }

  lastGood = await runParse(args, srcRoot)
  console.log(`  watching ${srcRoot} …`)

  fs.watch(srcRoot, { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(ts|tsx)$/.test(filename)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(rebuild, 300)
  })
}

/**
 * Walk the history, parsing a sample of commits, and write a timeline the
 * viewer can scrub. Each commit is checked out into a throwaway worktree, so
 * your working copy is never touched.
 */
async function runReplay(args: Args, srcRoot: string): Promise<void> {
  const repo = path.resolve(args.repo)
  const relSrc = path.relative(repo, srcRoot)
  if (relSrc.startsWith("..")) {
    console.error(`error: --src must live inside --repo (${repo})`)
    process.exit(1)
  }

  const commits = sampleCommits(repo, args.since, args.maxFrames)
  if (commits.length === 0) {
    console.error(`error: no commits since "${args.since}"`)
    process.exit(1)
  }
  console.log(
    `trame · replay\n  ${commits.length} frames from the history since ${args.since}`,
  )

  const config = await loadConfig(args.config)
  const started = Date.now()

  const parsed = forEachCommit(
    repo,
    commits,
    (checkoutRoot) => {
      const at = path.join(checkoutRoot, relSrc)
      if (!fs.existsSync(at)) return null // the folder did not exist yet
      const graph = parseOnce({ ...args, src: at }, at, resolveExclude(args, config))
      graph.analysis = { orphans: findOrphans(graph), cycles: findCycles(graph) }
      if (config) graph.violations = evaluateRules(graph, config)
      return graph
    },
    (i, total, commit) => {
      process.stdout.write(`\r  parsing ${i + 1}/${total} · ${commit.sha.slice(0, 8)}   `)
    },
  )
  process.stdout.write("\r" + " ".repeat(48) + "\r")

  const projectName = args.project ?? path.basename(repo)
  const timeline = buildTimeline(projectName, parsed)
  const outPath = path.resolve(args.out === defaultOut(args.format) ? "trame-replay.json" : args.out)
  fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2))

  const first = timeline.frames[0]
  const last = timeline.frames[timeline.frames.length - 1]
  console.log(
    `  ${timeline.frames.length} frames · ` +
      `${first?.nodeCount ?? 0} → ${last?.nodeCount ?? 0} files\n` +
      `  → ${outPath} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
  )
}

/**
 * A graph file this tool wrote earlier: the only input the caller names rather
 * than one we just produced.
 *
 * Pointed at the wrong path, or at a graph truncated by an interrupted write,
 * the failure used to surface far from here as a property read on undefined
 * inside the diff. Two `Array.isArray` calls buy a message that names the file.
 */
function readGraph(file: string): GraphData {
  const p = path.resolve(file)
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"))
  } catch (error) {
    // an fs error already names the path it failed on; a syntax error does not
    const message = (error as Error).message
    console.error(error instanceof SyntaxError ? `error: could not parse ${p} — ${message}` : `error: ${message}`)
    process.exit(1)
  }
  const graph = parsed as Partial<GraphData>
  if (!parsed || typeof parsed !== "object" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    console.error(
      `error: ${p} is not a trame graph — expected nodes and edges arrays\n` +
        `  generate one with: trame --src ./src --out ${file}`,
    )
    process.exit(1)
  }
  return parsed as GraphData
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === "diff") {
    if (!args.base || !args.head) {
      console.error("error: diff needs --base <file.json> and --head <file.json>")
      process.exit(1)
    }
    const base = readGraph(args.base)
    const head = readGraph(args.head)
    const merged = diffGraphs(base, head)
    const outPath = path.resolve(args.out)
    fs.writeFileSync(outPath, render(merged, args.format))
    const d = merged.diff!
    console.log(
      `trame · diff\n` +
        `  nodes \x1b[32m+${d.addedNodes}\x1b[0m \x1b[31m−${d.removedNodes}\x1b[0m · ` +
        `edges \x1b[32m+${d.addedEdges}\x1b[0m \x1b[31m−${d.removedEdges}\x1b[0m\n` +
        `  → ${outPath}`,
    )
    return
  }

  if (args.command === "serve") {
    serve({ dataFile: path.resolve(args.data), distDir: viewerDist(args.dist), port: args.port })
    return
  }

  const srcRoot = path.resolve(args.src)
  if (!fs.existsSync(srcRoot)) {
    console.error(`error: source directory not found: ${srcRoot}`)
    process.exit(1)
  }

  if (args.command === "replay") await runReplay(args, srcRoot)
  else if (args.command === "check") await runCheck(args, srcRoot)
  else if (args.command === "doctor") await runDoctor(args, srcRoot)
  else if (args.command === "blame") await runBlame(args, srcRoot)
  else if (args.command === "modules") await runModules(args, srcRoot)
  else if (args.command === "watch") await runWatch(args, srcRoot)
  else await runParse(args, srcRoot)
}

main().catch((error: unknown) => {
  // a bad config is the user's to fix and needs no stack trace; anything else
  // reaching here is our bug, and the trace is the useful part of the report
  if (error instanceof ConfigError) console.error(`error: ${error.message}`)
  else console.error(error)
  process.exit(1)
})
