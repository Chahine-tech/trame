/** Which editor deep-link scheme to use when jumping to a file. */
export type EditorScheme = "vscode" | "cursor" | "windsurf" | "zed"

const EDITOR_KEY = "archviz-editor"

export const EDITOR_LABEL: Record<EditorScheme, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  zed: "Zed",
}

export function getEditor(): EditorScheme {
  const v = localStorage.getItem(EDITOR_KEY)
  return v === "cursor" || v === "windsurf" || v === "zed" ? v : "vscode"
}

export function setEditor(scheme: EditorScheme): void {
  localStorage.setItem(EDITOR_KEY, scheme)
}

export function cycleEditor(): EditorScheme {
  const order: EditorScheme[] = ["vscode", "cursor", "windsurf", "zed"]
  const next = order[(order.indexOf(getEditor()) + 1) % order.length]!
  setEditor(next)
  return next
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
