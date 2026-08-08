import { reachable, useGraphStore } from "@trame/viewer/store/graph"

/**
 * Who the demo is about.
 *
 * Both the hero's timed script and the scrolled sections need the same answer,
 * and they must agree: a page that impacts one file and then traces a path
 * from a different one is showing two demos, not one story. Derived from the
 * graph every time rather than pinned to a filename, so nothing here has to be
 * revisited when the demo codebase changes.
 */

/**
 * The subject has to work for *both* beats, which pull in opposite directions.
 *
 * Hover shows a neighbourhood: it only reads if it is clearly a subset. The
 * busiest file here touches 16 of the other 23, so hovering it lit 71% of the
 * graph — no figure left against the ground.
 *
 * Impact shows transitive dependents, and there the point is that it is large:
 * "everything that would break" has to look like a wave. Optimising for a small
 * neighbourhood alone picks a leaf, whose impact set is two nodes and whose
 * amber wave shows nothing at all.
 *
 * So: score the neighbourhood toward a readable fraction, and reward a wide
 * blast radius. Derived from the graph, never a hard-coded filename, so this
 * survives a change of demo codebase.
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
 * The far end of the graph from the subject.
 *
 * Path tracing only demonstrates anything if the chain has links: a two-hop
 * path looks like a line someone drew. Taking the node with the longest
 * shortest-path gives the traced route something to walk through, and reading
 * it from the graph means it survives a change of demo codebase.
 */
export function farthestFrom(id: string): { id: string; label: string } | null {
  const { data, adjacency } = useGraphStore.getState()
  if (!data) return null
  const labels = new Map(data.nodes.map((n) => [n.id, n.label]))

  // undirected this time — a path may run with or against the imports
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
