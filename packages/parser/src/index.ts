#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Project } from "ts-morph"
import { buildGraph } from "./graph.js"
import { evaluateRules } from "./rules.js"
import { loadConfig } from "./config.js"
import { findCycles, findOrphans } from "./analysis.js"
import { diffGraphs } from "./diff.js"
import { toDot, toMarkdown, toMermaid } from "./export.js"
import { serve } from "./serve.js"
import { buildTimeline, forEachCommit, sampleCommits } from "./replay.js"
import type { GraphData, TrameConfig, Violation } from "./types.js"

interface Args {
  command: "parse" | "check" | "watch" | "serve" | "diff" | "replay"
  src: string
  out: string
  tsconfig?: string
  noTsconfig: boolean
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
 * Command-line exclusions plus whatever the config adds.
 *
 * The flag stays the escape hatch for a one-off run; the config is where a
 * project states, once, which of its folders are not architecture — generated
 * clients, vendored code, a legacy corner nobody wants on the map. Before this
 * the only way to say it was to retype the flag on every invocation, which
 * stopped being tolerable the moment the tool started being run through npx
 * instead of a wrapper script.
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
 *
 * Installed from npm the viewer ships inside the package, beside dist/. Inside
 * this repository it is another workspace, two levels up. Checking for the
 * bundled copy first means a published install never reaches for a monorepo
 * path that is not there — and an explicit --dist always wins, for anyone
 * serving a viewer they built themselves.
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
  trame watch --src ./src [--out ...]          re-parse on file changes
  trame serve --data ./trame.json [--port]   serve the built viewer
  trame diff --base a.json --head b.json       what a branch did to the architecture
  trame replay --src ./src [--since --max-frames]  how the architecture grew, across git history

  options:
    --tsconfig ./tsconfig.json   resolve path aliases through a specific tsconfig
    --no-tsconfig                ignore the tsconfig found next to --src
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
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i] ?? ""
    switch (a) {
      case "check":
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
 * Without one, every `@/thing` import resolves to nothing — and since that is
 * how most React projects have been written since roughly 2022, the default
 * run produced a graph with no edges and called it a success. Measured on one
 * ordinary portfolio: 1 edge and 13 orphans out of 19 files, against 19 edges
 * and 1 orphan with the flag. A cloud of dots that claims to be an
 * architecture is worse than an error.
 *
 * Found rather than required, because a tool whose first run is wrong unless
 * you knew to pass a flag has already lost the person who ran it.
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

function parseOnce(args: Args, srcRoot: string, exclude: string[] = args.exclude): GraphData {
  const tsconfig = args.noTsconfig
    ? undefined
    : args.tsconfig
      ? path.resolve(args.tsconfig)
      : findTsconfig(srcRoot)

  // said out loud: silent resolution is how the missing one went unnoticed
  if (tsconfig && !args.tsconfig) {
    console.log(`  tsconfig: ${path.relative(process.cwd(), tsconfig) || tsconfig}`)
  }

  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: false, jsx: 4 /* react-jsx */ } })

  project.addSourceFilesAtPaths([`${srcRoot}/**/*.ts`, `${srcRoot}/**/*.tsx`])
  for (const file of project.getSourceFiles()) {
    const p = file.getFilePath()
    if (exclude.some((pattern) => p.includes(pattern))) project.removeSourceFile(file)
  }

  const projectName = args.project ?? path.basename(path.dirname(srcRoot))
  const graph = buildGraph(project, srcRoot, projectName)
  graph.analysis = { orphans: findOrphans(graph), cycles: findCycles(graph) }
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

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === "diff") {
    if (!args.base || !args.head) {
      console.error("error: diff needs --base <file.json> and --head <file.json>")
      process.exit(1)
    }
    const base = JSON.parse(fs.readFileSync(path.resolve(args.base), "utf8")) as GraphData
    const head = JSON.parse(fs.readFileSync(path.resolve(args.head), "utf8")) as GraphData
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
  else if (args.command === "watch") await runWatch(args, srcRoot)
  else await runParse(args, srcRoot)
}

main()
