import type { Project } from "ts-morph"

export interface RawImport {
  /** absolute path of the importing file */
  from: string
  /** absolute path of the imported file */
  to: string
}

/**
 * Extract import relationships between project source files.
 * External modules (node_modules, bare specifiers that don't resolve
 * into the project) are ignored: the graph shows your own architecture.
 */
export function extractImports(project: Project): RawImport[] {
  const edges: RawImport[] = []
  const known = new Set(
    project
      .getSourceFiles()
      .filter((f) => !f.getFilePath().endsWith(".d.ts"))
      .map((f) => f.getFilePath() as string),
  )

  for (const file of project.getSourceFiles()) {
    const from = file.getFilePath() as string
    if (from.endsWith(".d.ts")) continue

    for (const decl of file.getImportDeclarations()) {
      const target = decl.getModuleSpecifierSourceFile()
      if (!target) continue
      const to = target.getFilePath() as string
      if (!known.has(to) || to === from) continue
      edges.push({ from, to })
    }

    // `export … from "./x"` re-exports are architecture edges too
    for (const decl of file.getExportDeclarations()) {
      const target = decl.getModuleSpecifierSourceFile()
      if (!target) continue
      const to = target.getFilePath() as string
      if (!known.has(to) || to === from) continue
      edges.push({ from, to })
    }
  }

  return edges
}
