#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Project } from "ts-morph"
import { buildGraph } from "./graph.js"
import { evaluateRules, loadConfig } from "./rules.js"
import { findCycles, findOrphans } from "./analysis.js"
import { diffGraphs } from "./diff.js"
import { serve } from "./serve.js"
import type { GraphData, Violation } from "./types.js"

interface Args {
  command: "parse" | "check" | "watch" | "serve" | "diff"
  src: string
  out: string
  tsconfig?: string
  config?: string
  project?: string
  exclude: string[]
  data: string
  port: number
  dist?: string
  base?: string
  head?: string
}

const DEFAULT_EXCLUDE = ["node_modules", "dist", ".test.", ".spec.", ".stories.", "__tests__", "__mocks__"]

const HELP = `archviz — parse a TypeScript/React codebase into a 3D architecture graph

  archviz --src ./src [--out ./archviz.json]     parse and write the graph
  archviz check --src ./src                      evaluate rules, exit 1 on violations
  archviz watch --src ./src [--out ...]          re-parse on file changes
  archviz serve --data ./archviz.json [--port]   serve the built viewer
  archviz diff --base a.json --head b.json       what a branch did to the architecture

  options:
    --tsconfig ./tsconfig.json   resolve paths through a tsconfig
    --config ./archviz.config.ts constraint rules (auto-detected in cwd)
    --project name               project name in meta
    --exclude a,b,c              extra path patterns to skip
    --data ./archviz.json        (serve) graph file to serve
    --port 3000                  (serve) port
    --dist ./path                (serve) viewer build override`

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "parse",
    src: "",
    out: "archviz.json",
    exclude: [...DEFAULT_EXCLUDE],
    data: "archviz.json",
    port: 3000,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i] ?? ""
    switch (a) {
      case "check":
      case "watch":
      case "serve":
      case "diff":
        args.command = a
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
      case "--src":
        args.src = next()
        break
      case "--out":
        args.out = next()
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
  if (!args.src && args.command !== "serve" && args.command !== "diff") {
    console.error("error: --src <dir> is required (try --help)")
    process.exit(1)
  }
  return args
}

function parseOnce(args: Args, srcRoot: string): GraphData {
  const project = args.tsconfig
    ? new Project({ tsConfigFilePath: path.resolve(args.tsconfig), skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: false, jsx: 4 /* react-jsx */ } })

  project.addSourceFilesAtPaths([`${srcRoot}/**/*.ts`, `${srcRoot}/**/*.tsx`])
  for (const file of project.getSourceFiles()) {
    const p = file.getFilePath()
    if (args.exclude.some((pattern) => p.includes(pattern))) project.removeSourceFile(file)
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
    `archviz · ${graph.meta.project}\n` +
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
  const graph = parseOnce(args, srcRoot)
  const config = await loadConfig(args.config)
  if (config) graph.violations = evaluateRules(graph, config)

  const outPath = path.resolve(args.out)
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2))
  if (!quiet) summarize(graph, outPath, Date.now() - started)
  return graph
}

async function runCheck(args: Args, srcRoot: string): Promise<void> {
  const graph = parseOnce(args, srcRoot)
  const config = await loadConfig(args.config)
  if (!config?.rules?.length) {
    console.error("error: no rules found — create archviz.config.ts or pass --config")
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

  const rebuild = async () => {
    if (running) return
    running = true
    const started = Date.now()
    try {
      const graph = await runParse(args, srcRoot, true)
      const vCount = graph.violations?.length ?? 0
      console.log(
        `  ↻ ${new Date().toLocaleTimeString()} · ${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} edges` +
          (vCount ? ` · \x1b[31m${vCount} violations\x1b[0m` : "") +
          ` (${Date.now() - started}ms)`,
      )
    } catch (err) {
      console.error(`  ✗ parse failed: ${err instanceof Error ? err.message : err}`)
    } finally {
      running = false
    }
  }

  await runParse(args, srcRoot)
  console.log(`  watching ${srcRoot} …`)

  fs.watch(srcRoot, { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(ts|tsx)$/.test(filename)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(rebuild, 300)
  })
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
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2))
    const d = merged.diff!
    console.log(
      `archviz · diff\n` +
        `  nodes \x1b[32m+${d.addedNodes}\x1b[0m \x1b[31m−${d.removedNodes}\x1b[0m · ` +
        `edges \x1b[32m+${d.addedEdges}\x1b[0m \x1b[31m−${d.removedEdges}\x1b[0m\n` +
        `  → ${outPath}`,
    )
    return
  }

  if (args.command === "serve") {
    const distDir = args.dist
      ? path.resolve(args.dist)
      : path.resolve(import.meta.dirname, "../../viewer/dist")
    serve({ dataFile: path.resolve(args.data), distDir, port: args.port })
    return
  }

  const srcRoot = path.resolve(args.src)
  if (!fs.existsSync(srcRoot)) {
    console.error(`error: source directory not found: ${srcRoot}`)
    process.exit(1)
  }

  if (args.command === "check") await runCheck(args, srcRoot)
  else if (args.command === "watch") await runWatch(args, srcRoot)
  else await runParse(args, srcRoot)
}

main()
