import { reachable, useGraphStore } from "@trame/viewer/store/graph"

/**
 * Who the demo is about. Read from the graph, never a filename, so a change of
 * demo codebase needs no edit here.
 *
 * The two beats pull in opposite directions. Hover needs a neighbourhood that
 * is clearly a subset: the busiest file touches 16 of the other 23, so hovering
 * it lit 71% of the graph. Impact needs a large one, or the wave shows nothing.
 * So the score aims the neighbourhood at a fraction and rewards blast radius.
 */
const IDEAL_NEIGHBOURHOOD = 0.3

export function subjectOf(): { id: string; label: string } | null {
  const { data, adjacency, importers } = useGraphStore.getState()
  if (!data || data.nodes.length === 0) return null
  const total = data.nodes.length

  // the very walk the impact lens will draw, so the file chosen for its blast
  // radius and the wave the visitor sees can never disagree
  const blastRadius = (id: string): number => reachable(importers, id).size / total

  let best: { id: string; label: string } | null = null
  let bestScore = -Infinity
  for (const node of data.nodes) {
    const neighbourhood = ((adjacency.get(node.id)?.size ?? 0) + 1) / total
    // distance from a readable neighbourhood dominates; blast radius breaks ties
    const score = -Math.abs(neighbourhood - IDEAL_NEIGHBOURHOOD) * 3 + blastRadius(node.id)
    if (score > bestScore) {
      bestScore = score
      best = { id: node.id, label: node.label }
    }
  }
  return best
}

/**
 * The far end of the graph from the subject: a two-hop path looks like a line
 * someone drew, so the traced route needs the longest shortest-path.
 */
export function farthestFrom(id: string): { id: string; label: string } | null {
  const { data, adjacency } = useGraphStore.getState()
  if (!data) return null
  const labels = new Map(data.nodes.map((n) => [n.id, n.label]))

  // undirected this time: a path may run with or against the imports
  const hops = reachable(adjacency, id)
  let furthest = 0
  for (const d of hops.values()) if (d > furthest) furthest = d
  // the last ring reached, sorted so the pick is the same on every visit
  const pick = [...hops]
    .filter(([, d]) => d === furthest)
    .map(([n]) => n)
    .sort()[0]
  if (!pick || pick === id) return null
  return { id: pick, label: labels.get(pick) ?? pick }
}

/**
 * Who the co-change beat is about, which is not who the rest is about.
 *
 * `subjectOf` aims at a neighbourhood that is a clear subset and a wide blast
 * radius, and on trame's own graph that picks `ui/toast.ts`, a file the history
 * never moves with anything: the beat would have opened on an empty answer.
 * Co-change asks a different question, so it gets its own reading of the graph,
 * still from the data and never from a filename.
 */
export function coChangeSubjectOf(): { id: string; label: string } | null {
  const { data } = useGraphStore.getState()
  const pairs = data?.coChange
  if (!data || !pairs?.length) return null

  const weight = new Map<string, number>()
  for (const c of pairs) {
    for (const id of [c.a, c.b]) weight.set(id, (weight.get(id) ?? 0) + c.jaccard)
  }
  let best: string | null = null
  for (const [id, w] of weight) if (best === null || w > weight.get(best)!) best = id
  const node = data.nodes.find((n) => n.id === best)
  return node ? { id: node.id, label: node.label } : null
}
