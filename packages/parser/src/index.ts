#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { Project } from "ts-morph"
import { buildGraph } from "./graph.js"

interface Args {
  src: string
  out: string
  tsconfig?: string
  project?: string
  exclude: string[]
}

const DEFAULT_EXCLUDE = ["node_modules", "dist", ".test.", ".spec.", ".stories.", "__tests__", "__mocks__"]

function parseArgs(argv: string[]): Args {
  const args: Args = { src: "", out: "archviz.json", exclude: [...DEFAULT_EXCLUDE] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i] ?? ""
    switch (a) {
      case "--src":
        args.src = next()
        break
      case "--out":
        args.out = next()
        break
      case "--tsconfig":
        args.tsconfig = next()
        break
      case "--project":
        args.project = next()
        break
      case "--exclude":
        args.exclude.push(...next().split(",").filter(Boolean))
        break
      case "--help":
      case "-h":
        console.log(
          "archviz — parse a TypeScript/React codebase into a 3D architecture graph\n\n" +
            "  archviz --src ./src [--out ./archviz.json] [--tsconfig ./tsconfig.json]\n" +
            "          [--project name] [--exclude a,b,c]",
        )
        process.exit(0)
    }
  }
  if (!args.src) {
    console.error("error: --src <dir> is required (try --help)")
    process.exit(1)
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const srcRoot = path.resolve(args.src)
  if (!fs.existsSync(srcRoot)) {
    console.error(`error: source directory not found: ${srcRoot}`)
    process.exit(1)
  }

  const started = Date.now()
  const project = args.tsconfig
    ? new Project({ tsConfigFilePath: path.resolve(args.tsconfig), skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: false, jsx: 4 /* react-jsx */ } })

  project.addSourceFilesAtPaths([`${srcRoot}/**/*.ts`, `${srcRoot}/**/*.tsx`])

  // Drop excluded files after globbing (simpler than negated globs, same result)
  for (const file of project.getSourceFiles()) {
    const p = file.getFilePath()
    if (args.exclude.some((pattern) => p.includes(pattern))) {
      project.removeSourceFile(file)
    }
  }

  const projectName = args.project ?? path.basename(path.dirname(srcRoot))
  const graph = buildGraph(project, srcRoot, projectName)

  const outPath = path.resolve(args.out)
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2))

  const byType = new Map<string, number>()
  for (const n of graph.nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1)
  const typeSummary = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t} ${c}`)
    .join(" · ")

  console.log(
    `archviz · ${projectName}\n` +
      `  ${graph.meta.nodeCount} nodes · ${graph.meta.edgeCount} edges · ${graph.clusters.length} clusters\n` +
      `  ${typeSummary}\n` +
      `  → ${outPath} (${Date.now() - started}ms)`,
  )
}

main()
