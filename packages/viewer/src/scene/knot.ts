import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force-3d"
import type { SimNode } from "d3-force-3d"
import type { Vec3 } from "../types"

/**
 * The knot, laid out on its own.
 *
 * The hotspot lens reports files that sit inside an import cycle, and drawing
 * the imports that tie them turned the map into long red traversals of the
 * whole canvas instead of an object. The cause is the one that has come up
 * three times now: a set that is cohesive in the graph is not cohesive in the
 * picture. The component's 61 files carry hundreds of imports to the rest of
 * the repository, and the global layout answers to all of them, so the members
 * end up scattered and every internal import is drawn as a crossing.
 *
 * A ring was the obvious repair and the arithmetic refused it. Ordered by a
 * greedy walk along real imports, only 35 of the component's 198 internal edges
 * fall between neighbours on the rim and the median gap is 12 places out of 61 —
 * against 8 and 16 for a random order, so the walk barely beats chance. It
 * cannot be fixed by a better ordering, because the thing is not a loop: 198
 * edges over 61 nodes is an internal degree of 6.5, where a cycle would have 2.
 * Tarjan calls any strongly connected component a cycle; this one is a mutually
 * recursive cluster, and drawing it as a ring would be a lie told by layout.
 *
 * So it is settled on its own instead. The same forces the whole graph uses,
 * run over the induced subgraph alone, where nothing external is pulling: the
 * members answer only to each other, which is exactly the claim being made
 * about them. Position then carries membership and internal adjacency, both
 * identity, which is what `CHANNELS.md` says the map may say.
 */
export interface KnotLayout {
  /** where each member goes, in world space */
  at: Map<string, Vec3>
  /** how far the arrangement reaches from its middle, for the camera */
  spread: number
}

/**
 * Ticks are fixed rather than run to convergence.
 *
 * A lens has to answer in the frame the key is pressed, and this is a small
 * graph: dub's largest knot is 61 nodes and 198 links, which settles in a few
 * milliseconds. Deterministic, so pressing `H` twice puts the knot back exactly
 * where it was rather than somewhere slightly different.
 */
const TICKS = 260

/**
 * How far apart the members sit, in world units.
 *
 * The knot has to read as one object, so it is drawn tight — but not so tight
 * that its files merge into a single blob, because the reader still has to be
 * able to pick one out and click its row. `link.distance` is the resting length
 * of an import; the whole-graph layout uses 14, and this is closer because the
 * knot is meant to look like a knot.
 */
const SPACING = 9

export function layOutKnot(
  members: string[],
  edges: { source: string; target: string }[],
  centre: Vec3,
): KnotLayout {
  if (members.length === 0) return { at: new Map(), spread: 0 }

  /**
   * Seeded off the index rather than at random, and never at the origin.
   *
   * `forceManyBody` divides by the distance between two nodes, so a set of
   * nodes that all start at exactly the same point produces infinities and the
   * arrangement comes out as NaN. The spiral is deterministic, which is what
   * makes the whole function deterministic.
   */
  const nodes: SimNode[] = members.map((id, i) => {
    const angle = i * 2.399963 // the golden angle, so the seed is never a line
    const r = SPACING * Math.sqrt(i + 1)
    return { id, x: Math.cos(angle) * r, y: Math.sin(angle) * r, z: ((i % 7) - 3) * SPACING * 0.4 }
  })

  const known = new Set(members)
  const links = edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }))

  const sim = forceSimulation(nodes, 3)
    .force(
      "link",
      forceLink(links)
        .id((d: SimNode) => d.id)
        .distance(SPACING)
        .strength(0.7),
    )
    // weaker than the whole graph's -60: this is a crowd being asked to stand
    // together, not a repository being spread out
    .force("charge", forceManyBody().strength(-34))
    .force("centre", forceCenter(0, 0, 0))
  sim.tick(TICKS)
  sim.stop()

  const at = new Map<string, Vec3>()
  let reach = 0
  for (const n of nodes) {
    const p: Vec3 = [(n.x ?? 0) + centre[0], (n.y ?? 0) + centre[1], (n.z ?? 0) + centre[2]]
    at.set(String(n.id), p)
    reach = Math.max(reach, Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0))
  }
  return { at, spread: reach }
}
