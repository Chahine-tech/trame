import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force-3d"
import type { SimNode } from "d3-force-3d"
import type { GraphData, Vec3 } from "../types"

/**
 * Gentle pull of every node toward its folder's centroid, so the grouping lives
 * in the geometry (Gestalt proximity) rather than in a drawing over it.
 */
function forceCluster(strength = 0.08) {
  let nodes: SimNode[] = []
  const force = (alpha: number) => {
    const centroids = new Map<string, { x: number; y: number; z: number; n: number }>()
    for (const d of nodes) {
      const key = d.cluster as string
      const c = centroids.get(key) ?? { x: 0, y: 0, z: 0, n: 0 }
      c.x += d.x ?? 0
      c.y += d.y ?? 0
      c.z += d.z ?? 0
      c.n++
      centroids.set(key, c)
    }
    const k = strength * alpha
    for (const d of nodes) {
      const c = centroids.get(d.cluster as string)
      if (!c || c.n < 2) continue
      d.vx = (d.vx ?? 0) + (c.x / c.n - (d.x ?? 0)) * k
      d.vy = (d.vy ?? 0) + (c.y / c.n - (d.y ?? 0)) * k
      d.vz = (d.vz ?? 0) + (c.z / c.n - (d.z ?? 0)) * k
    }
  }
  force.initialize = (n: SimNode[]) => {
    nodes = n
  }
  return force
}

/** Connected components of the import graph, read as undirected. */
function components(data: GraphData): { of: Map<string, number>; count: number } {
  const adjacent = new Map<string, string[]>()
  for (const n of data.nodes) adjacent.set(n.id, [])
  for (const e of data.edges) {
    adjacent.get(e.source)?.push(e.target)
    adjacent.get(e.target)?.push(e.source)
  }

  const of = new Map<string, number>()
  let count = 0
  for (const n of data.nodes) {
    if (of.has(n.id)) continue
    const queue = [n.id]
    of.set(n.id, count)
    while (queue.length > 0) {
      const id = queue.pop()!
      for (const next of adjacent.get(id) ?? []) {
        if (of.has(next)) continue
        of.set(next, count)
        queue.push(next)
      }
    }
    count++
  }
  return { of, count }
}

/** Breathing room between two packed components, in the same units as link distance. */
const COMPONENT_GAP = 18

/**
 * Park each disconnected component beside the others instead of letting it
 * drift away.
 *
 * `forceLink` pulls only along edges, so it acts inside a component and never
 * between two; `forceCenter` translates the cloud rather than attracting
 * anything. Nothing but unbounded repulsion is left between components, so they
 * accelerate apart until the camera frames empty space. A monorepo whose
 * packages do not import each other lands here, and so does any repository read
 * before its dependencies are installed.
 *
 * Attracting them all to the origin is worse: asked for the same destination
 * they arrive concentric, and a 44-file package ends up threaded through a
 * 17-file one. Measured, the two centroids sat 32 apart with radii of 130 and
 * 99.
 *
 * So they are placed rather than pulled. This only ever translates, so each
 * component keeps the shape the simulation gave it, and is dropped at the first
 * position on an outward spiral that clears everything already placed. Biggest
 * first, so the largest holds the middle.
 */
function packComponents(
  positions: Map<string, Vec3>,
  of: Map<string, number>,
  count: number,
  pinned?: Set<string>,
): void {
  const members: string[][] = Array.from({ length: count }, () => [])
  for (const [id, part] of of) if (positions.has(id)) members[part]!.push(id)

  const parts = members
    .map((ids, index) => {
      const centre: Vec3 = [0, 0, 0]
      for (const id of ids) {
        const p = positions.get(id)!
        centre[0] += p[0] / ids.length
        centre[1] += p[1] / ids.length
        centre[2] += p[2] / ids.length
      }
      /**
       * How wide the component reads, not how far its furthest stray reaches.
       *
       * A large component is hollow at the rim: on cal.com the biggest holds
       * 3066 files with 90% inside a radius of 862 and a tail out to 1470.
       * Reserving the bounding sphere pushed all 122 lone files past 1470, a
       * scene 3000 wide for a graph whose mass sat in the middle third. Past
       * the p90 the cloud is thin enough that a neighbour there costs nothing.
       */
      const spread = ids
        .map((id) => {
          const p = positions.get(id)!
          return Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])
        })
        .sort((a, b) => a - b)
      // too few to have a meaningful tail: take the whole thing
      const radius =
        spread[spread.length <= 12 ? spread.length - 1 : Math.floor(spread.length * 0.9)]!
      // a component holding a node the reader dragged has already been placed,
      // by them; it keeps its ground and the others are arranged around it
      const anchored = pinned !== undefined && ids.some((id) => pinned.has(id))
      return { index, ids, centre, radius, anchored }
    })
    // anchored first because they cannot move, then biggest, ties broken by
    // index so two runs agree
    .sort(
      (a, b) =>
        Number(b.anchored) - Number(a.anchored) || b.ids.length - a.ids.length || a.index - b.index,
    )

  const placed: { at: Vec3; radius: number }[] = []
  for (const part of parts) {
    const at = part.anchored ? part.centre : freeSpot(placed, part.radius)
    placed.push({ at, radius: part.radius })
    if (part.anchored) continue
    for (const id of part.ids) {
      const p = positions.get(id)!
      positions.set(id, [
        p[0] - part.centre[0] + at[0],
        p[1] - part.centre[1] + at[1],
        p[2] - part.centre[2] + at[2],
      ])
    }
  }
}

/**
 * The first point on an outward spiral that clears every component already
 * placed. Directions follow the golden angle, so successive candidates spread
 * over the sphere rather than marching along one axis and building a line.
 */
function freeSpot(placed: { at: Vec3; radius: number }[], radius: number): Vec3 {
  if (placed.length === 0) return [0, 0, 0]

  const golden = Math.PI * (3 - Math.sqrt(5))
  const step = radius + COMPONENT_GAP

  /**
   * Start at the first shell that could possibly clear the largest component
   * already placed, rather than walking out from the middle.
   *
   * The biggest is always placed first and sits at the origin, so nothing can
   * be closer than its radius plus ours. On cal.com that skipped most of the
   * search for each of the 146 components: every one of them had to clear a
   * 3066-node giant, and testing the shells inside it was work that could only
   * ever fail.
   */
  const widest = Math.max(...placed.map((p) => p.radius))
  const first = Math.max(1, Math.ceil((widest + radius + COMPONENT_GAP) / step))

  for (let i = (first - 1) * 8 + 1; i < (first + 512) * 8; i++) {
    // walk outwards a shell at a time, trying several directions on each
    const shell = Math.ceil(i / 8)
    const angle = i * golden
    // flattened towards the viewing plane: a graph read from the front should
    // spread sideways rather than stack towards the camera
    const height = Math.sin(i * golden * 0.5) * 0.35
    const scale = Math.sqrt(1 - height * height)
    const distance = shell * step
    const at: Vec3 = [
      Math.cos(angle) * scale * distance,
      height * distance,
      Math.sin(angle) * scale * distance,
    ]
    const clear = placed.every(
      (p) =>
        Math.hypot(at[0] - p.at[0], at[1] - p.at[1], at[2] - p.at[2]) >=
        p.radius + radius + COMPONENT_GAP,
    )
    if (clear) return at
  }
  return [0, 0, 0]
}

/** Stop coarsening once the graph is small enough to place outright. */
const COARSEST = 40
/** Guard against a graph that refuses to shrink. */
const MAX_LEVELS = 14
/** Ticks spent on the coarsest graph, where a tick costs almost nothing. */
const COARSE_TICKS = 200
/** Ticks spent on each intermediate refinement. */
const REFINE_TICKS = 30
/**
 * Ticks left for the real graph once it starts from a considered arrangement.
 *
 * The flat layout spent 300 of these discovering global structure one nudge at
 * a time: on cal.com, 3451 nodes and 9458 edges at about 31 ms a tick, close to
 * eight seconds of blocked main thread before anything could be drawn. Starting
 * from the structure, all that is left is to stop files overlapping.
 *
 * Measured on cal.com by the distance from each file to its nearest neighbour:
 * with no ticks the median is 0.52 and the graph is a pile; by ten it is 23.8,
 * and twenty or forty neither improve it nor make it worse. Ten it is.
 */
const FINE_TICKS = 10

/** One coarsening step: how the finer level folds into this one. */
interface Level {
  /** how many nodes this level holds */
  size: number
  /** index at the finer level, mapped to its index at this one */
  up: number[]
  links: { a: number; b: number; w: number }[]
}

function adjacencyOf(size: number, links: { a: number; b: number; w: number }[]) {
  const adjacent: Map<number, number>[] = Array.from({ length: size }, () => new Map())
  for (const { a, b, w } of links) {
    if (a === b) continue
    adjacent[a]!.set(b, (adjacent[a]!.get(b) ?? 0) + w)
    adjacent[b]!.set(a, (adjacent[b]!.get(a) ?? 0) + w)
  }
  return adjacent
}

/**
 * Fold the graph by grouping each node with the neighbours it is most tied to:
 * one pass of Louvain's local moves, keeping the grouping and discarding the
 * modularity it was chosen for.
 *
 * The classic coarsener is Walshaw's heavy-edge matching, which pairs each node
 * with its strongest free neighbour. It fails on import graphs: a node can only
 * pair with a neighbour nobody has taken, so a utility imported by two hundred
 * files pairs with one of them and leaves the other 199 with no free neighbour.
 * Measured on cal.com, matching went 3451 to 2361 to 1806 and then crawled,
 * still at 1075 nodes after fourteen levels, so none of the work was saved.
 *
 * Communities have no such limit: the whole star collapses in one step, and the
 * same graph folds 3451 to 588 to 216. Skewed degree is the normal shape of a
 * dependency graph, so this is not a detail of one repository.
 */
function coarsen(size: number, links: { a: number; b: number; w: number }[]): Level | null {
  const adjacent = adjacencyOf(size, links)
  const degree = new Float64Array(size)
  let m = 0
  for (const { a, b, w } of links) {
    if (a === b) continue
    degree[a]! += w
    degree[b]! += w
    m += w
  }
  if (m === 0) return null

  const community = new Array<number>(size)
  for (let i = 0; i < size; i++) community[i] = i
  const total = Float64Array.from(degree)

  // index order, which the parser emits deterministically, so the same
  // repository always folds the same way
  for (let sweep = 0; sweep < 8; sweep++) {
    let moved = false
    for (let i = 0; i < size; i++) {
      const from = community[i]!
      const ki = degree[i]!
      const into = new Map<number, number>()
      for (const [j, w] of adjacent[i]!) {
        into.set(community[j]!, (into.get(community[j]!) ?? 0) + w)
      }
      total[from]! -= ki
      let best = from
      let bestGain = (into.get(from) ?? 0) / m - (total[from]! * ki) / (2 * m * m)
      for (const [c, w] of into) {
        if (c === from) continue
        const gain = w / m - (total[c]! * ki) / (2 * m * m)
        if (gain > bestGain + 1e-12) {
          bestGain = gain
          best = c
        }
      }
      total[best]! += ki
      if (best === from) continue
      community[i] = best
      moved = true
    }
    if (!moved) break
  }

  const renumbered = new Map<number, number>()
  for (const c of community) if (!renumbered.has(c)) renumbered.set(c, renumbered.size)
  const up = community.map((c) => renumbered.get(c)!)
  const coarse = renumbered.size

  // nothing merged: another pass would only repeat itself
  if (coarse >= size) return null

  const merged = new Map<string, number>()
  for (const { a, b, w } of links) {
    const x = up[a]!
    const y = up[b]!
    if (x === y) continue
    const key = x < y ? `${x},${y}` : `${y},${x}`
    merged.set(key, (merged.get(key) ?? 0) + w)
  }
  const coarseLinks = [...merged].map(([key, w]) => {
    const [a, b] = key.split(",")
    return { a: Number(a), b: Number(b), w }
  })

  return { size: coarse, up, links: coarseLinks }
}

/** Settle an anonymous weighted graph, seeded or from scratch. */
function settle(
  size: number,
  links: { a: number; b: number; w: number }[],
  seed: Vec3[] | null,
  ticks: number,
): Vec3[] {
  const nodes: SimNode[] = Array.from({ length: size }, (_, i) => {
    const node: SimNode = { id: String(i) }
    if (seed) {
      node.x = seed[i]![0]
      node.y = seed[i]![1]
      node.z = seed[i]![2]
    }
    return node
  })
  const sim = forceSimulation(nodes, 3)
    .force(
      "link",
      forceLink(links.map((l) => ({ source: String(l.a), target: String(l.b) })))
        .id((d: SimNode) => d.id)
        .distance(14)
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-60))
    .force("center", forceCenter(0, 0, 0))
  sim.tick(ticks)
  sim.stop()
  return nodes.map((n) => [n.x ?? 0, n.y ?? 0, n.z ?? 0] as Vec3)
}

/**
 * Open a coarse arrangement out into the finer level below it.
 *
 * Each fine node starts where its coarse representative sits, nudged apart so
 * the simulation has a gradient: two nodes at identical coordinates feel no
 * repulsion and stay welded. The arrangement is scaled by the cube root of the
 * growth in node count, the factor by which a volume grows at constant density.
 *
 * Which nudge hardly matters. The multi-level drawing literature compares a
 * small circle, the neighbours' barycentre, and the parent with a jitter, and
 * reports no significant difference in the result.
 */
function openOut(up: number[], coarse: Vec3[], fineSize: number): Vec3[] {
  const growth = Math.cbrt(Math.max(1, fineSize / Math.max(1, coarse.length)))
  const seed: Vec3[] = new Array(fineSize)
  for (let i = 0; i < fineSize; i++) {
    const parent = coarse[up[i]!] ?? [0, 0, 0]
    // deterministic, and different for the two children of one parent
    const angle = i * 2.39996
    seed[i] = [
      parent[0] * growth + Math.cos(angle) * 0.9,
      parent[1] * growth + Math.sin(angle * 1.7) * 0.9,
      parent[2] * growth + Math.sin(angle) * 0.9,
    ]
  }
  return seed
}

/**
 * A starting position for every node, found by shrinking the graph until it is
 * small, arranging that, and opening it back out.
 *
 * The multi-level paradigm: a hierarchy of approximations solved at the
 * coarsest level and refined downwards. Faster, since the expensive levels
 * start from an arrangement that is broadly right, and better, since a flat
 * simulation only sees local neighbourhoods.
 */
function multilevelSeed(data: GraphData): Map<string, Vec3> {
  const index = new Map(data.nodes.map((n, i) => [n.id, i]))
  const links: { a: number; b: number; w: number }[] = []
  for (const e of data.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    links.push({ a, b, w: 1 })
  }

  const levels: Level[] = []
  let size = data.nodes.length
  let current = links
  while (size > COARSEST && levels.length < MAX_LEVELS) {
    const level = coarsen(size, current)
    if (!level) break
    levels.push(level)
    size = level.size
    current = level.links
  }

  let positions = settle(size, current, null, COARSE_TICKS)

  // downwards, stopping one short: the real graph is settled by the caller,
  // which owns the forces that only make sense there
  for (let k = levels.length - 1; k >= 0; k--) {
    const fineSize = k === 0 ? data.nodes.length : levels[k - 1]!.size
    const seed = openOut(levels[k]!.up, positions, fineSize)
    positions = k === 0 ? seed : settle(fineSize, levels[k - 1]!.links, seed, REFINE_TICKS)
  }

  return new Map(data.nodes.map((n, i) => [n.id, positions[i] ?? ([0, 0, 0] as Vec3)]))
}

export interface LayoutOptions {
  /** positions from the previous graph, so the mental map survives a reload */
  previous?: Map<string, Vec3>
  /** nodes the user dragged: frozen, never moved by the simulation */
  pinned?: Set<string>
}

/**
 * Static 3D force layout: settle synchronously, then the scene is calm.
 *
 * On a watch-mode reload the simulation restarts from the previous positions
 * and pinned nodes stay put, so only genuinely new nodes find a place.
 *
 * Synchronous, having been tried the other way. Settling a slice per frame
 * cannot work: one tick of the full graph costs about 31 ms, already two
 * frames, so no slice is small enough to keep up and the scene judders. Once
 * the multi-level pass brought the whole thing under a second there was
 * nothing left worth slicing.
 */
export function runLayout(data: GraphData, options: LayoutOptions = {}): Map<string, Vec3> {
  const { previous, pinned } = options
  let hadPrevious = false
  let unseeded = 0

  const nodes: SimNode[] = data.nodes.map((n) => {
    const node: SimNode = { id: n.id, cluster: n.cluster }
    // positions persisted in the file win, then the live previous layout
    const seed =
      previous?.get(n.id) ?? (n.x !== undefined ? ([n.x, n.y!, n.z!] as Vec3) : undefined)
    if (!seed) unseeded++
    if (seed) {
      hadPrevious = true
      node.x = seed[0]
      node.y = seed[1]
      node.z = seed[2]
      if (pinned?.has(n.id)) {
        node.fx = seed[0]
        node.fy = seed[1]
        node.fz = seed[2]
      }
    }
    return node
  })

  const links = data.edges.map((e) => ({ source: e.source, target: e.target }))

  const sim = forceSimulation(nodes, 3)
    .force(
      "link",
      forceLink(links)
        .id((d: SimNode) => d.id)
        .distance(14)
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-60))
    .force("center", forceCenter(0, 0, 0))
    .force("cluster", forceCluster())

  /**
   * A file where every node already carries a position is the layout.
   *
   * The warm start exists to place newcomers among settled nodes; with no
   * newcomer, ticking walks the graph away from the coordinates it was given.
   * Measured on the landing's baked file: every node moved 14 units on average
   * and the graph inflated 28% (p90 radius 33.7 to 43.1), which pushed nodes
   * out of frame. It also ran synchronously in the effect that mounts the
   * scene, while the renderer compiled shaders.
   */
  const settled = data.nodes.length > 0 && unseeded === 0 && !previous

  /**
   * Nothing to build on, and big enough that building blindly hurts. A warm
   * start already knows where everything goes and a small graph settles in a
   * few hundred cheap ticks, so neither is worth coarsening for. This is the
   * cold open that blocked the main thread for eight seconds.
   */
  const cold = !hadPrevious && !settled && data.nodes.length > COARSEST
  if (cold) {
    const seeded = multilevelSeed(data)
    for (const node of nodes) {
      const p = seeded.get(node.id as string)
      if (!p) continue
      node.x = p[0]
      node.y = p[1]
      node.z = p[2]
    }
  }

  sim.tick(settled ? 0 : hadPrevious ? 60 : cold ? FINE_TICKS : 300)
  sim.stop()

  const positions = new Map<string, Vec3>()
  for (const n of nodes) positions.set(n.id, [n.x ?? 0, n.y ?? 0, n.z ?? 0])

  /**
   * Only when the graph is genuinely in pieces. A connected graph is one
   * component, and packing one component is a translation to the origin that
   * `forceCenter` has already performed.
   *
   * A warm start has to be packed too, tempting as it is to skip: those 60
   * ticks also run with nothing holding the components together, and they drift
   * about 80 units apart each time. A watch-mode session would walk them back
   * out one save at a time.
   */
  const parts = components(data)
  if (parts.count > 1) packComponents(positions, parts.of, parts.count, pinned)

  return positions
}
