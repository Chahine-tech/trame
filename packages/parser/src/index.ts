#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Project } from "ts-morph"
import { buildGraph } from "./graph.js"
import { evaluateRules, loadConfig } from "./rules.js"
import type { GraphData, Violation } from "./types.js"

interface Args {
  command: "parse" | "check" | "watch"
  src: string
  out: string
  tsconfig?: string
  config?: string
  project?: string
  exclude: string[]
}

const DEFAULT_EXCLUDE = ["node_modules", "dist", ".test.", ".spec.", ".stories.", "__tests__", "__mocks__"]

const HELP = `archviz — parse a TypeScript/React codebase into a 3D architecture graph

  archviz --src ./src [--out ./archviz.json]     parse and write the graph
  archviz check --src ./src                      evaluate rules, exit 1 on violations
  archviz watch --src ./src [--out ...]          re-parse on file changes

  options:
    --tsconfig ./tsconfig.json   resolve paths through a tsconfig
    --config ./archviz.config.ts constraint rules (auto-detected in cwd)
    --project name               project name in meta
    --exclude a,b,c              extra path patterns to skip`

function parseArgs(argv: string[]): Args {
  const args: Args = { command: "parse", src: "", out: "archviz.json", exclude: [...DEFAULT_EXCLUDE] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i] ?? ""
    switch (a) {
      case "check":
      case "watch":
        args.command = a
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
  if (!args.src) {
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
  return buildGraph(project, srcRoot, projectName)
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
  console.log(
    `archviz · ${graph.meta.project}\n` +
      `  ${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} edges · ${graph.clusters.length} clusters` +
      (vCount ? ` · \x1b[31m${vCount} violations\x1b[0m` : "") +
      `\n  ${typeSummary}\n  → ${outPath} (${ms}ms)`,
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
