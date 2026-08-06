import type { SourceFile } from "ts-morph"
import type { NodeType } from "../types.js"

/**
 * File-level classification, one node per source file (v0.1 granularity).
 * Order matters: a .tsx AuthProvider that calls createContext is a context,
 * not a component.
 */
export function classify(file: SourceFile): NodeType {
  const path = file.getFilePath()
  const base = (path.split("/").pop() ?? "").replace(/\.[jt]sx?$/, "")
  const text = file.getFullText()

  if (/createContext\s*[<(]/.test(text)) return "context"

  const importsFrom = (mod: string) =>
    file.getImportDeclarations().some((d) => d.getModuleSpecifierValue() === mod)
  if (importsFrom("zustand") && /\bcreate\s*[<(]/.test(text)) return "store"
  if (/\bconfigureStore\s*\(/.test(text)) return "store"

  if (/^use[A-Z]/.test(base)) return "hook"

  if (/Page$/.test(base)) return "page"
  if (/\/(pages|routes)\//.test(path)) return "page"
  // Next.js app router entrypoints
  if (/\/app\//.test(path) && /^(page|layout)$/.test(base)) return "page"

  if (path.endsWith(".tsx")) return "component"

  if (/\b(fetch|axios|ky)\s*[.(]/.test(text)) return "api"
  if (/^(api|client|http)/i.test(base) || /(Api|Client)$/.test(base)) return "api"

  return "module"
}

/** Display label — "index" files take their folder's name. */
export function labelFor(file: SourceFile): string {
  const parts = file.getFilePath().split("/")
  const base = (parts.pop() ?? "").replace(/\.[jt]sx?$/, "")
  if (base === "index" || base === "page" || base === "layout") {
    return parts.pop() ?? base
  }
  return base
}

/** Line of the first export, for jump-to-source in the viewer. */
export function firstExportLine(file: SourceFile): number {
  const text = file.getFullText()
  const idx = text.search(/^export /m)
  if (idx === -1) return 1
  return text.slice(0, idx).split("\n").length
}

/**
 * Cluster = feature folder. `src/features/auth/…` → "auth",
 * otherwise the first directory under src, otherwise "root".
 */
export function clusterFor(relPath: string): string {
  const parts = relPath.split("/")
  const featIdx = parts.findIndex((p) => p === "features" || p === "modules")
  if (featIdx !== -1 && parts.length > featIdx + 2) return parts[featIdx + 1]!
  if (parts.length > 1) return parts[0]!
  return "root"
}
