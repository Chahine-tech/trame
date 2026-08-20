/** Which editor deep-link scheme to use when jumping to a file. */
export type EditorScheme = "vscode" | "cursor" | "windsurf" | "zed"

const EDITOR_KEY = "trame-editor"

export const EDITOR_LABEL: Record<EditorScheme, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  zed: "Zed",
}

export const EDITORS: EditorScheme[] = ["vscode", "cursor", "windsurf", "zed"]

export function getEditor(): EditorScheme {
  const v = localStorage.getItem(EDITOR_KEY)
  return v === "cursor" || v === "windsurf" || v === "zed" ? v : "vscode"
}

export function setEditor(scheme: EditorScheme): void {
  localStorage.setItem(EDITOR_KEY, scheme)
}

/** "Try the next one" — the right affordance for the toast's recovery button. */
export function cycleEditor(): EditorScheme {
  const next = EDITORS[(EDITORS.indexOf(getEditor()) + 1) % EDITORS.length]!
  setEditor(next)
  return next
}

/**
 * Where a node's file lives on this machine, or null when it lives on none.
 *
 * Nodes carry a path relative to the parsed root, and the root itself is
 * recorded once in the graph's metadata — so a published graph simply omits it
 * and no longer describes anybody's disk. A graph without a root is a graph
 * somebody else parsed: there is nothing here to open, and guessing would send
 * the editor after a file that does not exist.
 *
 * Graphs written before the split carry an absolute path on every node; those
 * still open, since a path that is already absolute needs no root.
 */
export function locate(file: string | undefined, root: string | undefined): string | null {
  if (!file) return null
  if (file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) return file
  if (!root) return null
  return `${root.replace(/[/\\]$/, "")}/${file}`
}

/**
 * Jump to a file at a line. Synthetic nodes (API endpoints, query keys)
 * carry the call site in `file`, so they open where they're used.
 */
export function openInEditor(file: string, line: number): void {
  if (!file) return
  const scheme = getEditor()
  // zed uses file:line, the vscode family uses ?file=…:line
  const url =
    scheme === "zed"
      ? `zed://file${file}:${line}`
      : `${scheme}://file${file}:${line}`
  window.location.href = url
}
