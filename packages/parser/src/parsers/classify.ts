import fs from "node:fs"
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

  if (base.endsWith("Page")) return "page"
  if (/\/(pages|routes)\//.test(path)) return "page"
  // Next.js app router entrypoints
  if (/\/app\//.test(path) && /^(page|layout)$/.test(base)) return "page"

  if (path.endsWith(".tsx")) return "component"

  if (/\b(fetch|axios|ky)\s*[.(]/.test(text)) return "api"
  if (/^(api|client|http)/i.test(base) || /(Api|Client)$/.test(base)) return "api"

  return "module"
}

/**
 * Display label. Files whose own name says nothing borrow their folder's.
 *
 * `index` can take the folder name outright: there is only one per folder, so
 * nothing collides. `page` and `layout` cannot, since the Next.js app router puts
 * both in the same directory, and handing them the same name produced two
 * nodes called "app" in a real project, indistinguishable in the graph, in an
 * export, and in any advice that names them. They keep the folder for context
 * and their own name to stay apart.
 */
export function labelFor(file: SourceFile): string {
  const parts = file.getFilePath().split("/")
  const base = (parts.pop() ?? "").replace(/\.[jt]sx?$/, "")
  if (base === "index") return parts.pop() ?? base
  if (base === "page" || base === "layout") {
    const folder = parts.pop()
    return folder ? `${folder}/${base}` : base
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
 * Cluster = folder. `src/features/auth/…` → "auth", otherwise the first
 * directory under src. Files sitting at the src root belong to "src":
 * a name the user recognizes, never parser jargon like "root".
 */
/**
 * The package a file belongs to, when the codebase is a workspace.
 *
 * Found by walking up to the nearest package.json, which is what a package
 * actually is, with no list of blessed container names to keep current. Cached per
 * directory because thousands of files share a handful of answers.
 *
 * Without it, clustering falls back to the first path segment, and pointing
 * --src at a monorepo root put 2576 of cal.com's 5032 files in one cluster
 * called "packages". Districts, community detection and every folder
 * comparison were reading a container as if it were a module.
 */
const packageCache = new Map<string, string | null>()

export function packageFor(absPath: string, srcRoot: string): string | null {
  let dir = absPath.slice(0, absPath.lastIndexOf("/"))
  const seen: string[] = []
  while (dir.startsWith(srcRoot) && dir.length >= srcRoot.length) {
    const hit = packageCache.get(dir)
    if (hit !== undefined) {
      for (const d of seen) packageCache.set(d, hit)
      return hit
    }
    seen.push(dir)
    if (fs.existsSync(`${dir}/package.json`) && dir !== srcRoot) {
      const name = dir.slice(dir.lastIndexOf("/") + 1)
      for (const d of seen) packageCache.set(d, name)
      return name
    }
    const parent = dir.slice(0, dir.lastIndexOf("/"))
    if (parent === dir || parent.length < srcRoot.length) break
    dir = parent
  }
  for (const d of seen) packageCache.set(d, null)
  return null
}

export function clusterFor(relPath: string): string {
  const parts = relPath.split("/")
  const featIdx = parts.findIndex((p) => p === "features" || p === "modules")
  if (featIdx !== -1 && parts.length > featIdx + 2) return parts[featIdx + 1]!
  if (parts.length > 1) return parts[0]!
  return "src"
}
