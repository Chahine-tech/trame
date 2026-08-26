import type { GraphNode } from "../types"

/**
 * What to write beside each file, given who else is on screen.
 *
 * A file's name is its basename, short and usually enough, until two
 * of them are drawn at once. cal.com holds a `PaymentService.ts` for every
 * payment integration and a `zod-utils.ts` in two places, so a neighbourhood
 * could show the same four letters four times over with no way to tell which
 * was which.
 *
 * Only the ambiguous ones grow: a name is qualified by as much of its path as
 * it takes to be unique among the files it shares the screen with, and no more.
 * Nothing is qualified pre-emptively, so the common case stays short.
 */
export function disambiguate(nodes: GraphNode[]): Map<string, string> {
  const names = new Map<string, string>()
  const byLabel = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const same = byLabel.get(node.label)
    if (same) same.push(node)
    else byLabel.set(node.label, [node])
  }

  for (const [label, sharing] of byLabel) {
    if (sharing.length === 1) {
      names.set(sharing[0]!.id, label)
      continue
    }

    // walk up a directory at a time until the names come apart, or the paths
    // run out: two files can genuinely differ only by a segment nobody sees
    const parts = sharing.map((n) => n.id.split("/").slice(0, -1))
    const deepest = Math.max(0, ...parts.map((p) => p.length))
    for (let up = 1; up <= deepest + 1; up++) {
      const candidates = sharing.map((_, i) => {
        const prefix = parts[i]!.slice(-up)
        return prefix.length > 0 ? `${prefix.join("/")}/${label}` : label
      })
      if (new Set(candidates).size === sharing.length || up === deepest + 1) {
        sharing.forEach((n, i) => names.set(n.id, candidates[i]!))
        break
      }
    }
  }

  return names
}
