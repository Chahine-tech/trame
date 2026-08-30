import type { GraphEdge } from "../types"

/**
 * Every file's coreness: the largest k for which it survives in the k-core.
 *
 * The k-core is what remains after repeatedly deleting every file with fewer
 * than k neighbours. Peeling like that is the cheapest way to separate a
 * codebase's load-bearing structure from the leaves hanging off it, and unlike
 * a ranking it measures mutual density rather than popularity.
 *
 * It does *not*, however, get rid of the universal utilities: on cal.com
 * `prisma`, `constants` and `logger` all sit in the deepest shell, because
 * everything in the core imports them and so they are densely connected by
 * construction. They have to be excluded on purpose, see `impassable`. Ten of
 * them account for thirty per cent of the edges inside cal.com's core, and
 * removing them leaves it connected, which is the tell: they carry no
 * structure, only traffic.
 *
 * Linear in files plus imports.
 */
export function coreness(ids: string[], edges: GraphEdge[]): Map<string, number> {
  const neighbours = new Map<string, Set<string>>()
  for (const id of ids) neighbours.set(id, new Set())
  for (const e of edges) {
    if (e.source === e.target) continue
    neighbours.get(e.source)?.add(e.target)
    neighbours.get(e.target)?.add(e.source)
  }

  const degree = new Map<string, number>()
  for (const [id, near] of neighbours) degree.set(id, near.size)

  const shell = new Map<string, number>()
  const remaining = new Set(ids)
  let k = 0

  while (remaining.size > 0) {
    // peel everything currently below the waterline, then raise it
    let peeled = true
    while (peeled) {
      peeled = false
      for (const id of remaining) {
        if (degree.get(id)! > k) continue
        remaining.delete(id)
        shell.set(id, k)
        for (const other of neighbours.get(id)!) {
          if (remaining.has(other)) degree.set(other, degree.get(other)! - 1)
        }
        peeled = true
      }
    }
    k++
  }
  return shell
}

/**
 * The load-bearing files, cut so that what remains fits on screen.
 *
 * `k` is not a setting: it is the shallowest depth whose core comes in under
 * budget, so a small repository keeps everything and a large one shows its
 * skeleton. On cal.com that lands at 6 or 7, around two hundred files out of
 * three and a half thousand; on trame's own thirty files it withholds
 * nothing at all.
 *
 * Returns null when the whole graph already fits, which is how every graph the
 * tool has drawn until now keeps behaving exactly as it did.
 */
export function skeleton(ids: string[], edges: GraphEdge[], budget: number): Set<string> | null {
  if (ids.length <= budget) return null

  /**
   * The utilities come out first, and this is a second rule rather than a
   * consequence of the first: coreness puts them at the centre, since being
   * imported by everything that matters makes a file as densely connected as
   * anything can be. `coreness` above measures what removing them costs.
   */
  const traffic = impassable(ids, edges)
  const structural = ids.filter((id) => !traffic.has(id))
  const shell = coreness(structural, edges)
  const deepest = Math.max(0, ...shell.values())

  for (let k = 1; k <= deepest; k++) {
    const core = structural.filter((id) => (shell.get(id) ?? 0) >= k)
    if (core.length <= budget) return new Set(core)
  }
  // dense enough that even the deepest shell overflows: show that, rather than
  // nothing, and let the caller's own limits apply
  return new Set(structural.filter((id) => (shell.get(id) ?? 0) >= deepest))
}

/**
 * What a file talks to, out to `hops`, without routing through the codebase's
 * universal utilities.
 *
 * Two hops is the readable distance: on cal.com the median file reaches 94
 * others that way, and 8% of files blow past four hundred. Every one of those
 * explosions runs through the same handful of files (`logger`, `constants`,
 * `prisma`) which connect everything to everything and so say nothing about
 * where a file sits. Declining to *route* through them (they are still drawn if
 * they are adjacent) brings the median to 35 and the worst case inside budget,
 * and it does so without discarding a single real relationship.
 */
export function neighbourhood(
  focus: string,
  edges: GraphEdge[],
  hops: number,
  // named for what it does here, not for the function that produced it: it is
  // `impassable()`'s result, and sharing its name hid the function inside
  blocked: Set<string>,
): Set<string> {
  const neighbours = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    let near = neighbours.get(a)
    if (!near) neighbours.set(a, (near = new Set()))
    near.add(b)
  }
  for (const e of edges) {
    if (e.source === e.target) continue
    add(e.source, e.target)
    add(e.target, e.source)
  }

  const seen = new Set([focus])
  let frontier = [focus]
  for (let hop = 0; hop < hops; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      // shown, but not travelled through; the focus itself always expands
      if (id !== focus && blocked.has(id)) continue
      for (const other of neighbours.get(id) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
      }
    }
    frontier = next
  }
  return seen
}

/**
 * The files that connect everything to everything.
 *
 * Taken as a share of the graph rather than a fixed degree, so the notion
 * survives a change of scale: what counts is being far outside the ordinary,
 * not crossing a number somebody wrote down. cal.com's ordinary file has three
 * neighbours and its worst offender has three hundred and ninety-seven.
 */
export function impassable(ids: string[], edges: GraphEdge[], share = 0.03): Set<string> {
  const degree = new Map<string, number>()
  for (const e of edges) {
    if (e.source === e.target) continue
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }
  // anything wired to more than this fraction of the codebase is infrastructure
  const limit = Math.max(20, Math.round(ids.length * share))
  return new Set(ids.filter((id) => (degree.get(id) ?? 0) >= limit))
}

/**
 * The widest view of a file's surroundings that still fits on screen.
 *
 * Two hops is the readable distance and almost always affordable: on cal.com
 * the median file reaches 32 others and only one in a hundred passes four
 * hundred. Almost always is not always: opening on `handleCancelBooking`, which
 * is exactly the kind of well-connected file worth opening on, reached 426. So
 * the reach is chosen rather than assumed, and a file with an unusually busy
 * neighbourhood is shown one hop of it rather than a screenful nobody can read.
 */
export function fittingNeighbourhood(
  focus: string,
  edges: GraphEdge[],
  impassableIds: Set<string>,
  budget: number,
): Set<string> {
  let last = neighbourhood(focus, edges, 1, impassableIds)
  for (let hops = 2; hops <= 3; hops++) {
    const wider = neighbourhood(focus, edges, hops, impassableIds)
    if (wider.size > budget) return last
    last = wider
  }
  return last
}

/**
 * The widest whole rings of a propagation that fit inside a budget.
 *
 * A lens changes the question, so it should be allowed to change what is
 * drawn. The detail view answers "what is near this file" and reaches two
 * hops; impact answers "what would break", which on dub's `tinybird` is 948
 * files across twelve rings. Drawn inside the ordinary neighbourhood, 57 of
 * the 59 visible nodes sat at the same depth: the ring-by-ring reveal, which
 * is the whole idea of the lens, had nothing to reveal.
 *
 * Whole rings only. Half a ring is a boundary the reader would mistake for the
 * edge of the impact set, and the point of the wave is that it ends where the
 * consequences do. Measured on dub, `tinybird` fills rings 0 to 4 with 309
 * files and ring 5 alone would add 260 more, so the budget lands where the
 * fade was already calibrated.
 */
export function fittingRings(depth: Map<string, number>, budget: number): Set<string> {
  const rings = new Map<number, string[]>()
  for (const [id, d] of depth) {
    const ring = rings.get(d)
    if (ring) ring.push(id)
    else rings.set(d, [id])
  }
  const kept = new Set<string>()
  let total = 0
  for (const d of [...rings.keys()].sort((a, b) => a - b)) {
    const ring = rings.get(d)!
    // the first ring is what directly breaks, so it goes in whatever it costs:
    // a universal utility can have more direct dependents than the renderer is
    // comfortable with, and answering "948 would break" with one dot on screen
    // is worse than a slow frame
    if (d > 1 && total + ring.length > budget) break
    for (const id of ring) kept.add(id)
    total += ring.length
  }
  return kept
}
