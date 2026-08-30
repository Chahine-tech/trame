import { create } from "zustand"
import type { EdgeType, GraphData, Timeline, Vec3 } from "../types"
import { runLayout } from "../scene/Layout"
import { BUDGET, READABLE } from "../scene/budget"
import { fittingNeighbourhood, fittingRings, impassable, skeleton } from "../scene/skeleton"
import { disambiguate } from "../scene/names"
import { diagnose, type Finding } from "tramejs/doctor"
import { simulateDelete, type WhatIfReport } from "./whatif"
import { replayOf, type Replay } from "./timeline"
import type { LensKind } from "./lens"
import { densestFolder, knotOf } from "./reading"
import { layOutKnot } from "../scene/knot"

/**
 * Toasts, fetched when one is needed and only where one can be drawn.
 *
 * The toast library pulls in framer-motion, 56 kB gzip that the landing shipped
 * in its critical chunk for messages it never shows, since the store is all it
 * imports from the viewer. App.tsx imports the module statically, so in the
 * viewer this resolves from cache.
 *
 * The deferred import alone was not enough: the landing drives this store and
 * mounts no toaster, so any action of its own that reached a toast paid the
 * fetch for a message with nowhere to appear. `sections.ts` calls `clear()` and
 * `tracePathTo()`, both of which can. Guarding here rather than at each call
 * site means a toast added later cannot reopen the hole.
 */
function toast(show: (m: typeof import("../ui/toast")) => void): void {
  if (!useGraphStore.getState().toastsMounted) return
  void import("../ui/toast").then(show)
}

/**
 * Everything that transitively reaches `from`, with the number of hops.
 *
 * Exported because the landing picks its demo subject by this same walk: two
 * walks that can drift apart are one too many.
 *
 * `neighbours` is a direction, not a fixed map: pass `importers` for "what
 * depends on this", `adjacency` for "what is near this".
 */
export function reachable(neighbours: Map<string, Set<string>>, from: string): Map<string, number> {
  const depth = new Map<string, number>([[from, 0]])
  let frontier = [from]
  let d = 0
  while (frontier.length > 0) {
    d++
    const next: string[] = []
    for (const id of frontier) {
      for (const n of neighbours.get(id) ?? []) {
        if (depth.has(n)) continue
        depth.set(n, d)
        next.push(n)
      }
    }
    frontier = next
  }
  return depth
}

/**
 * Every lens off. Each activator spreads this first, so mutual exclusion is
 * stated once instead of being re-derived (and quietly forgotten) in each one.
 */
function noLens() {
  return {
    lens: "none" as LensKind,
    impactOf: null,
    impactDepth: new Map<string, number>(),
    pathNodes: [] as string[],
    pathEdges: new Set<string>(),
    whatIf: null,
    whatIfOrphaned: new Set<string>(),
    whatIfBroken: new Set<string>(),
    coChangeOf: null,
    coChangeWith: new Map<string, number>(),
    hotspotHeat: new Map<string, number>(),
    hotspotKnot: new Set<string>(),
    hotspotKnotEdges: new Set<string>(),
    hotspotKnotAt: new Map<string, Vec3>(),
    hotspotStartedAt: 0,
  }
}

/**
 * Turns a true bounding radius into the `extent` the rig expects.
 *
 * `extent` is a size and the rig parks at 1.35 times it, which with a 60°
 * vertical field of view shows 1.35·tan(30°) = 0.78 of it. That is right
 * everywhere else, because `reachOf` clamps at two and a half medians and on a
 * hundred-file neighbourhood the clamp binds hard, leaving `extent` well under
 * the real reach. On a handful of files it never binds: dub's webhook route and
 * its five partners sit at radii 38, 128, 128, 162, 192, 220 around their
 * centre, median 162 and 2.5 medians 404, so `extent` came back as the furthest
 * 220 — and the camera at 297 showed 171, cropping the two outermost through
 * the top and the bottom of the screen.
 *
 * 1/(1.35·tan 30°) = 1.28 puts the furthest exactly on the edge. The rest is
 * margin, part of which the inspector's 150px offset takes back.
 */
const FRAME_WHOLE = 1.45

/** E cycles through: everything, then each edge type, then everything */
const EDGE_FILTER_CYCLE: (EdgeType | null)[] = [
  null,
  "import",
  "component",
  "api-call",
  "query-key",
  "context",
]

interface GraphState {
  data: GraphData | null
  positions: Map<string, Vec3>
  adjacency: Map<string, Set<string>>
  inDeg: Map<string, number>
  outDeg: Map<string, number>

  hoverId: string | null
  selectedId: string | null
  selectedEdgeId: string | null
  /** node ids lit by the current hover/selection (node + direct neighbours) */
  litSet: Set<string>

  /**
   * Where the camera is asked to fly. Transient: the rig clears it on arrival.
   */
  focusTarget: Vec3 | null
  /**
   * The middle of what is drawn, kept for as long as it is drawn.
   *
   * `extent` says how big the subject is and this says where it is, and the
   * two are read together by everything that turns them into a camera
   * distance. Only the size used to be kept: `reachOf` returns both, and every
   * caller threw the centre away into `focusTarget`, which the rig deletes the
   * moment it lands. So five frames after any move, the scene knew how big the
   * subject was and had forgotten where — and each consumer guessed, mostly by
   * assuming the origin. A neighbourhood is a knot off to one side, so they
   * disagreed by however far off to the side it was.
   */
  viewCentre: Vec3
  /**
   * The direction to approach `focusTarget` from. Null keeps the current angle.
   *
   * The rig rebuilds its direction each frame from the centre it is flying to,
   * so a flight only ever changes distance. Restoring a lens that way came back
   * rotated, because the outbound leg aimed at a different centre.
   */
  focusDir: Vec3 | null
  /**
   * Where the reader is standing: the point they are looking at, and the side
   * they are looking from. The rig publishes it when a flight settles.
   *
   * `at` is not always `viewCentre`: `focus()`, which a shared link and `F`
   * both call, aims at one file and leaves `viewCentre` on the middle of what
   * is drawn. On dub's tinybird those are [260.1, 7.5, 140.6] and
   * [243.4, -2.8, 95.0], fifty units apart, so recomputing the centre on the
   * way out of a lens moved the camera by that much.
   *
   * Null until a flight has settled. A default was tried and sent a lens back
   * to the origin on any graph where nothing had landed yet.
   */
  vantage: { at: Vec3; dir: Vec3 } | null
  /** …captured the moment a lens takes the camera, spent when it gives it back. */
  savedVantage: { at: Vec3; dir: Vec3 } | null
  setVantage: (at: Vec3, dir: Vec3) => void
  /**
   * Whether anything on screen can present a notice. Off until a host says so,
   * which gates both `toast()` and the undo offer that depends on one.
   */
  toastsMounted: boolean
  setToastsMounted: (on: boolean) => void
  /**
   * What the last `clear()` let go of, while the offer to take it back stands.
   * Null otherwise, which is what gates `⌘Z` against a notice still on screen.
   */
  cleared: { selectedId: string; lens: LensKind; vantage: { at: Vec3; dir: Vec3 } | null } | null
  restoreCleared: () => void
  /** When the last selection was committed, for the background-click guard. */
  selectedAt: number
  clearFromBackground: () => void
  /** OrbitControls gate, off while dragging a Bezier handle */
  controlsEnabled: boolean

  /** user-edited Bézier control points, by edge id */
  ctrl: Map<string, { c1: Vec3; c2: Vec3 }>

  /**
   * Rule violations by node, split into what each one is saying.
   *
   * `about` is the difference between "this file has twenty-one callers" and
   * "this file is one of them". Both used to arrive as the same red sentence,
   * so a file whose only involvement was calling something read as the
   * offender — and on dub that is twenty-one files wrongly accused per
   * endpoint. A cycle sets it on every member, which is the truth there: the
   * loop is not one file's doing.
   */
  violatedNodes: Map<string, { message: string; about: boolean }[]>
  violatedEdges: Map<string, string[]>

  /** nodes nothing imports: likely dead code */
  orphans: Set<string>

  /**
   * Everything `doctor` found, ranked, kept.
   *
   * It was already computed on every load and thrown away: `openOnFinding` ran
   * `diagnose`, took the first cycle it could stand in, and dropped the other
   * hundred and forty-two. On dub that is 80 violations, 17 cycles and 46
   * orphans — each with a sentence saying what to do about it, none of which
   * ever reached the screen. The counts in the top bar have been sitting over
   * them the whole time.
   */
  findings: Finding[]
  /** which kind the rail is listing, or null when it is not open */
  browsing: Finding["kind"] | null
  browse: (kind: Finding["kind"] | null) => void
  /** go to a finding: select where it is, and fly there */
  goToFinding: (f: Finding) => void

  /** directed adjacency, for impact and path queries */
  importers: Map<string, Set<string>>
  imports: Map<string, Set<string>>

  /** "if I change this, what breaks?": depth per transitive dependent (I) */
  impactOf: string | null
  impactDepth: Map<string, number>
  /** when the current impact query started, for the ring-by-ring reveal */
  impactStartedAt: number
  toggleImpact: () => void

  /**
   * "what moves with this that nothing connects it to?" (C), and how strongly.
   *
   * The partners are by construction not in the neighbourhood: the whole claim
   * is that no import reaches them. So the lens has to widen the view to them,
   * or it would draw an empty answer over the files that were already there.
   */
  coChangeOf: string | null
  coChangeWith: Map<string, number>
  /**
   * How high each hotspot stands in the ranking, 1 for the first and 0 for the
   * last, empty when the lens is off. See `toggleHotspots` for why it is drawn
   * on the log of the rank rather than on the counts themselves.
   */
  hotspotHeat: Map<string, number>
  /**
   * The answer, inside the ranking: the pressured files that sit in an import
   * cycle. Empty when the lens is off, and empty on a repository with no cycles,
   * where the lens falls back to reporting the ranking's shape.
   *
   * Kept beside `hotspotHeat` rather than derived in each consumer so the
   * sentence, the marks and the camera cannot come to disagree — the same reason
   * `densestFolder` is shared. `store/reading.ts` owns the definition.
   */
  hotspotKnot: Set<string>
  /**
   * The imports that tie the knot together — what the map draws as the answer.
   * `store/reading.ts` owns the definition; see `Knot.edges` for why they are
   * the induced subgraph rather than a loop through each cycle in order.
   */
  hotspotKnotEdges: Set<string>
  /**
   * Where the knot's files stand while the lens is up, overriding `positions`.
   *
   * An override rather than a write, so leaving the lens cannot leave the graph
   * deformed: this map is cleared by `noLens()` and every reader falls back to
   * the real layout. `scene/knot.ts` says why the arrangement exists and why it
   * is not a ring.
   */
  hotspotKnotAt: Map<string, Vec3>
  /**
   * When the knot began gathering, or 0 when the lens is off.
   *
   * The nodes glide to their new places and the imports that tie them wait,
   * then draw themselves in. Not decoration: the edge geometry is memoised on
   * its endpoints, so following the nodes frame by frame would rebuild 273
   * tubes sixty times a second — and drawing them at the destination while the
   * nodes are still in transit detaches every line from both its ends, which
   * looks like a rendering fault rather than a movement.
   *
   * The same shape as `impactStartedAt`, and the reveal is the one the arrival
   * already uses: a draw range along the tube, so a line grows from one file to
   * the other instead of appearing whole.
   */
  hotspotStartedAt: number
  toggleCoChange: () => void
  toggleHotspots: () => void
  /** follow a row of the ranking: aim the camera at it, keep the lens */
  pickHotspot: (id: string) => void

  /** dependency path between two nodes (shift-click) */
  pathNodes: string[]
  pathEdges: Set<string>
  tracePathTo: (targetId: string) => void

  /** cluster bubbles visibility (G) */
  showClusters: boolean
  toggleClusters: () => void

  /** node labels visibility (L) */
  showLabels: boolean
  toggleLabels: () => void

  /** edge type filter (E cycles); null shows everything */
  edgeFilter: EdgeType | null
  cycleEdgeFilter: () => void

  /** PNG export request, consumed by the in-canvas capture helper (⌘E) */
  pngRequested: boolean
  requestPng: () => void
  clearPng: () => void

  /** reposition a node (drag); connected edges follow */
  moveNode: (id: string, pos: Vec3) => void
  /** nodes the user placed by hand, frozen out of the simulation */
  pinned: Set<string>

  /** true when no trame.json was served and the demo graph stands in */
  isDemo: boolean

  /**
   * When the current graph started arriving, or 0 to skip the entrance. Only
   * the landing turns it on; a watch reload should not replay a build-in.
   */
  arrivedAt: number
  playArrival: () => void

  /** zoomed out far enough that folders stand in for their files */
  districtMode: boolean
  setDistrictMode: (v: boolean) => void

  /**
   * Which files the detail view may draw, `null` when the whole graph fits.
   *
   * Stepping inside used to mount every node and edge in the repository: on
   * cal.com, 3451 files and 9458 imports, around 25 800 draw calls. Measured on
   * that graph, 500 files are comfortable and 1000 are not.
   */
  nearby: Set<string> | null
  setNearby: (ids: Set<string> | null) => void
  /** the load-bearing files, kept so returning from a selection is instant */
  skeletonSet: Set<string> | null
  /** files wired to so much of the codebase that routing through them says nothing */
  traffic: Set<string>
  /** what to write beside each file, qualified only where two share a name */
  names: Map<string, string>
  /**
   * How far the arrangement reaches, as the ninetieth percentile radius.
   *
   * Every camera distance used to be a constant written for a graph the size of
   * trame's own: start at 80, collapse to districts past 115, never pull back
   * beyond 220. cal.com's skeleton reaches 402, so all four sat inside the
   * cloud with no way to rise above the map. They are ratios of this now.
   */
  extent: number
  /**
   * How deep the framed set runs along the view — the fog's scale, and nothing
   * else's.
   *
   * Split off `extent` because they are different questions and had started
   * giving different answers. `extent` became a reach measured across the view,
   * which is what a camera needs and what a fog must not use: on dub's ranking
   * the two differ by nearly a factor of two, so a fog scaled off the framing
   * would have closed in on a scene that had not got any shallower, and the one
   * set in this viewer that must not have a depth gradient would have grown one.
   * That was patched once, by taking the marks out of the fog. This is the
   * payment, and the patch goes with it.
   */
  depth: number

  /** the architecture replayed across git history, when one was generated */
  timeline: Timeline | null
  /** rebuilds any frame of it, walking the changes from the first */
  replay: Replay | null
  frameIndex: number
  /** the live graph, parked while a replay is on screen */
  present: GraphData | null
  loadTimeline: (t: Timeline) => void
  enterReplay: () => void
  exitReplay: () => void
  showFrame: (index: number) => void
  /** ids the current frame introduced or dropped, for the replay highlight */
  frameAdded: Set<string>
  frameRemoved: Set<string>

  /** which question the colours are answering; only one at a time */
  lens: LensKind
  /** drop the lens but keep the selection: esc walks back one step at a time */
  clearLens: () => void
  /** the view a selection alone would show, for a lens closing behind itself */
  restoreView: () => {
    nearby: Set<string> | null
    names: Map<string, string>
    extent: number
    focusTarget: Vec3
    viewCentre: Vec3
    focusDir: Vec3 | null
    savedVantage: { at: Vec3; dir: Vec3 } | null
  }

  /** "what if I deleted this?": the consequences, computed but not applied */
  whatIf: WhatIfReport | null
  whatIfOrphaned: Set<string>
  whatIfBroken: Set<string>
  toggleWhatIf: () => void

  load: (data: GraphData, isDemo?: boolean) => void
  /** select the worst problem the load-bearing files are involved in */
  openOnFinding: () => void
  setHover: (id: string | null) => void
  select: (id: string | null) => void
  selectEdge: (id: string | null) => void
  focus: (id: string) => void
  resetCamera: () => void
  clearFocus: () => void
  setControlsEnabled: (v: boolean) => void
  setCtrl: (edgeId: string, c1: Vec3, c2: Vec3) => void
  resetCtrl: (edgeId: string) => void
  clear: () => void
}

/**
 * Where a set of files sits, and how far it spreads around that.
 *
 * Measured from the middle of the set, not from the origin. A neighbourhood is
 * a knot off to one side, so its distance from the origin says how far away it
 * is, not how big it is, and using that framed a thumbnail in an empty screen.
 */
/**
 * Where a set of files sits, and how far it reaches from there.
 *
 * `along` is the direction the camera is looking from, and when it is given the
 * reach is measured across that direction rather than around the centre. The
 * two are not the same number and the gap is not small. Measured on dub's 150
 * hotspots: radius 413 at the furthest, but half-extents of 269, 384 and 240 on
 * the three axes, so which of them the screen's vertical picks up depends
 * entirely on where the reader is standing. Framed on 413 from an angle that
 * shows the 240, the constellation used a little over half the height it was
 * given and sat in a field of empty ground.
 *
 * Depth is the part that never mattered: a set framed from further away is not
 * seen from further away in the direction it is deep. It mattered less than
 * nothing here, because the hotspot lens draws every mark at a fixed size, so
 * the only question left is whether the thing fits across the window.
 */
/**
 * Where a file stands right now, which is not always where the layout put it.
 *
 * The hotspot lens gathers each knot onto itself, and it does that as an
 * override rather than by writing `positions`, so that leaving the lens cannot
 * leave the graph deformed. Every reader has to go through here or the picture
 * comes apart: a node drawn at the knot with its edges drawn to where it used
 * to be is worse than not moving it at all.
 */
export function positionOf(
  s: Pick<GraphState, "positions" | "hotspotKnotAt">,
  id: string,
): Vec3 | undefined {
  return s.hotspotKnotAt.get(id) ?? s.positions.get(id)
}

export interface Reach {
  /** the middle of the set */
  at: Vec3
  /**
   * How far it reaches across the view — the camera's question, and only the
   * camera's. What a reader sees of a set is its width and height on screen;
   * how deep it runs towards them costs nothing and shows nothing.
   */
  across: number
  /**
   * How far it reaches along the view — the fog's question.
   *
   * These were one number for a long time and it worked because the number was
   * a plain radius, which is wrong for both but wrong by the same amount. The
   * moment the camera started measuring across the view the two parted company:
   * the ranking's files reach 413 from the middle while the screen's vertical
   * only ever picks up 240 to 384 of it, so a fog scaled off the framing radius
   * would have pulled in around a scene that had not got any shallower.
   *
   * Equal to `across` when no view direction is known, which is the honest
   * answer: without one there is no across and no along, only a radius.
   */
  deep: number
}

function reachOf(ids: string[], positions: Map<string, Vec3>, along?: Vec3): Reach {
  const points = ids.map((id) => positions.get(id)).filter((p): p is Vec3 => Boolean(p))
  if (points.length === 0) return { at: [0, 0, 0], across: 60, deep: 60 }

  const at: Vec3 = [0, 0, 0]
  for (const p of points) {
    at[0] += p[0] / points.length
    at[1] += p[1] / points.length
    at[2] += p[2] / points.length
  }
  const len = along ? Math.hypot(along[0], along[1], along[2]) : 0
  const axis: Vec3 | null = len > 1e-6 ? [along![0] / len, along![1] / len, along![2] / len] : null

  const across: number[] = []
  const deep: number[] = []
  for (const p of points) {
    const d: Vec3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]]
    if (!axis) {
      const r = Math.hypot(d[0], d[1], d[2])
      across.push(r)
      deep.push(r)
      continue
    }
    const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
    across.push(Math.hypot(d[0] - t * axis[0], d[1] - t * axis[1], d[2] - t * axis[2]))
    deep.push(Math.abs(t))
  }

  /**
   * Frame everything, unless one file has wandered absurdly far.
   *
   * Trimming the outermost tenth was the first attempt: on the forty files
   * around a selection it dropped four off screen, one of them a hub cut in
   * half at the margin. Framing to the very furthest is no better. cal.com's
   * cancellation neighbourhood runs to 81 at the median and 187 at the
   * ninety-fifth with a single file at 323, and letting that one decide would
   * halve the other thirty-nine.
   *
   * So the whole set counts, up to a few times the middle of it — and each
   * direction is clamped against its own distribution, because a set can be
   * wide and shallow or narrow and long, and one median cannot describe both.
   */
  const bounded = (xs: number[]) => {
    xs.sort((a, b) => a - b)
    const median = xs[Math.floor(xs.length / 2)] ?? 60
    const furthest = xs[xs.length - 1] ?? 60
    return Math.max(40, Math.min(furthest, median * 2.5))
  }
  return { at, across: bounded(across), deep: bounded(deep) }
}

function computeLit(state: Pick<GraphState, "adjacency">, id: string | null): Set<string> {
  const lit = new Set<string>()
  if (!id) return lit
  lit.add(id)
  for (const n of state.adjacency.get(id) ?? []) lit.add(n)
  return lit
}

/**
 * What the view draws for a set of ids, and how the camera frames it.
 *
 * Shared by the selection and by the lenses that widen past it, so a lens can
 * change what is on screen and hand it back untouched when it closes.
 */
function viewOf(
  ids: Set<string> | null,
  data: GraphData | null,
  positions: Map<string, Vec3>,
  /**
   * Where the reader is standing, when anyone knows.
   *
   * Every framing in this store measured a radius around the middle of a set,
   * and a radius is not what a camera has to fit — the screen only ever gets
   * the part across the view. The hotspot lens was corrected first and the
   * difference was not marginal: its ranking reaches 413 from the middle while
   * the screen's vertical picks up between 240 and 384 of that depending on
   * where the reader happens to be, so the constellation sat in a little over
   * half the height it had been given. Every other lens had the same error and
   * kept it while the fog was still reading the same number.
   *
   * Absent on the opening framing, where no camera has settled yet, and there
   * `reachOf` falls back to the radius — the honest answer when there is no
   * view to measure across.
   */
  along?: Vec3,
) {
  const nodes = ids && data ? data.nodes.filter((n) => ids.has(n.id)) : (data?.nodes ?? [])
  const { at, across, deep } = reachOf(
    nodes.map((n) => n.id),
    positions,
    along,
  )
  return {
    nearby: ids,
    names: disambiguate(nodes),
    extent: across,
    depth: deep,
    focusTarget: at,
    viewCentre: at,
    // a fresh framing is somewhere new: keep the angle the reader is holding.
    // Only a lens closing behind itself asks for a particular one.
    focusDir: null as Vec3 | null,
    // and a fresh framing is not something to come back to, so any vantage a
    // lens was holding for its own return is spent. Openers re-take theirs
    // after this spread.
    savedVantage: null as { at: Vec3; dir: Vec3 } | null,
  }
}

export const useGraphStore = create<GraphState>((set, get) => ({
  data: null,
  positions: new Map(),
  adjacency: new Map(),
  inDeg: new Map(),
  outDeg: new Map(),

  hoverId: null,
  selectedId: null,
  selectedEdgeId: null,
  litSet: new Set(),

  focusTarget: null,
  viewCentre: [0, 0, 0] as Vec3,
  focusDir: null,
  vantage: null,
  savedVantage: null,
  cleared: null,
  selectedAt: 0,
  toastsMounted: false,
  setToastsMounted: (on) => set({ toastsMounted: on }),
  setVantage: (at, dir) => set({ vantage: { at, dir } }),
  controlsEnabled: true,

  ctrl: new Map(),

  violatedNodes: new Map(),
  violatedEdges: new Map(),

  orphans: new Set(),

  findings: [],
  browsing: null,
  browse: (kind) => set({ browsing: kind }),
  /**
   * A finding is a place, not a mode. It hands the reader to the machinery that
   * already exists — select, fly — rather than inventing a sixth way for the
   * graph to be painted. The rail stays open behind it, so a list of a hundred
   * and forty-three is walked, not consumed one at a time.
   */
  goToFinding: (f) => {
    const { adjacency, positions } = get()
    // the member of the finding that shows the most of it at once, the same
    // rule `openOnFinding` uses to choose where to stand in a cycle
    const at = f.nodeIds
      .filter((id) => positions.has(id))
      .sort(
        (a, b) =>
          (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b),
      )[0]
    if (!at) return
    const keep = get().browsing
    get().select(at)
    get().focus(at)
    set({ browsing: keep })
  },

  importers: new Map(),
  imports: new Map(),

  impactOf: null,
  impactDepth: new Map(),
  impactStartedAt: 0,
  coChangeOf: null,
  coChangeWith: new Map(),
  hotspotHeat: new Map(),
  hotspotKnot: new Set(),
  hotspotKnotEdges: new Set(),
  hotspotKnotAt: new Map(),
  hotspotStartedAt: 0,
  /** the view a selection alone would show, for a lens closing behind itself */
  restoreView: () => {
    const { selectedId, skeletonSet, data, traffic, positions } = get()
    const nearby =
      selectedId && skeletonSet && data
        ? fittingNeighbourhood(selectedId, data.edges, traffic, READABLE)
        : skeletonSet
    // `viewOf` recomputes the middle of the neighbourhood, which frames it
    // fresh but does not hand it back: restoring the angle onto a recomputed
    // centre left the view fifty units off on the first round trip. Both
    // halves of where the reader stood, or neither.
    const view = viewOf(nearby, data, positions, get().vantage?.dir)
    const stood = get().savedVantage
    return stood ? { ...view, focusTarget: stood.at, focusDir: stood.dir } : view
  },

  toggleImpact: () => {
    const { selectedId, impactOf, importers, data, positions, vantage } = get()
    if (impactOf) {
      set({ ...noLens(), ...get().restoreView() })
      return
    }
    if (!selectedId) {
      toast((t) => t.toastNeedsSelection("Impact"))
      return
    }
    // everything that would break, and how far from the change it sits
    const depth = reachable(importers, selectedId)
    /**
     * The lens widens the view to the propagation it is describing.
     *
     * The detail view reaches two hops, which on dub's `tinybird` put 57 of
     * the 59 visible files at the same depth: the ring-by-ring reveal had
     * nothing to reveal, and the bar read "948 dependents" over a picture of
     * the first circle. Whole rings up to the render budget instead, which for
     * that file is 309 files across the four the fade is calibrated for.
     */
    set({
      ...noLens(),
      ...viewOf(fittingRings(depth, BUDGET), data, positions, vantage?.dir),
      // after the spread, which cleared it: this is the angle to come back to
      savedVantage: vantage,
      lens: "impact",
      impactOf: selectedId,
      impactDepth: depth,
      impactStartedAt: performance.now(),
    })
  },

  toggleCoChange: () => {
    const { selectedId, coChangeOf, data, positions, skeletonSet, traffic, vantage } = get()
    if (coChangeOf) {
      set({ ...noLens(), ...get().restoreView() })
      return
    }
    if (!data?.coChange?.length) {
      toast((t) => t.toastNoCoChange())
      return
    }
    if (!selectedId) {
      toast((t) => t.toastNeedsSelection("Co-change"))
      return
    }
    const partners = new Map<string, number>()
    for (const c of data.coChange) {
      if (c.a === selectedId) partners.set(c.b, c.jaccard)
      else if (c.b === selectedId) partners.set(c.a, c.jaccard)
    }
    if (partners.size === 0) {
      toast((t) => t.toastNoCoChangeFor(get().names.get(selectedId) ?? selectedId))
      return
    }
    /**
     * Draw the neighbourhood, frame the answer. They are not the same set.
     *
     * Excluding imported pairs does not make a partner distant in the graph: on
     * dub's webhook route all five were already inside the 132-file
     * neighbourhood, two hops away through some hub. So framing the union
     * framed the neighbourhood, `reachOf` clamped the spread at 2.5 medians,
     * and two of the five answers were drawn outside the picture — one of them
     * leaving through the top of the screen.
     *
     * The neighbourhood is context and stays drawn. The camera belongs to the
     * question, which is this file and what moves with it, the way the impact
     * lens frames its propagation rather than where the propagation started.
     */
    const near =
      skeletonSet && data ? fittingNeighbourhood(selectedId, data.edges, traffic, READABLE) : null
    const answer = [selectedId, ...partners.keys()]
    const shown = new Set([...(near ?? []), ...answer])
    const { at, across, deep } = reachOf(answer, positions, vantage?.dir)
    set({
      ...noLens(),
      ...viewOf(shown, data, positions, vantage?.dir),
      // after the spread, which framed everything drawn
      extent: across * FRAME_WHOLE,
      depth: deep * FRAME_WHOLE,
      focusTarget: at,
      viewCentre: at,
      savedVantage: vantage,
      lens: "cochange",
      coChangeOf: selectedId,
      coChangeWith: partners,
    })
  },

  toggleHotspots: () => {
    const { data, lens, positions, vantage } = get()
    if (lens === "hotspots") {
      set({ ...noLens(), ...get().restoreView() })
      return
    }
    if (!data?.hotspots?.length) {
      toast((t) => t.toastNoHotspots())
      return
    }
    /**
     * The one lens that asks nothing of the reader.
     *
     * Every other lens answers about a file; this one answers about the
     * codebase. The answer is a sentence — the panel says which folder holds
     * the most of it and in what proportion — and the map's job is to stand
     * where that sentence points.
     */
    const heat = new Map<string, number>()
    const span = Math.log(Math.max(data.hotspots.length, 2))
    /**
     * A log of the rank. Three scales were measured on dub's 150: the raw
     * product paints one file and a flat floor, since the top scores 132x776
     * against 11x12 at the tail; rank spread linearly puts the first and the
     * twentieth 7% apart, which is invisible. The log of the rank opens that to
     * 36% and, caring only about the order, cannot be distorted by an outlier.
     */
    data.hotspots.forEach((h, i) => heat.set(h.id, 1 - Math.log(i + 1) / span))

    /**
     * Frame the answer, and the answer is the knot.
     *
     * This framed one folder, then the whole ranking, and both were right at the
     * time. The folder was a compromise forced by node size — 150 files in view
     * came to 1.8 CSS pixels each against 5.9 for `lib/zod`'s 23 — and it
     * expired when `mark.ts` fixed the mark at eleven pixels wherever it stands.
     * The whole ranking followed, because the ranking was then the answer.
     *
     * It no longer is. A percentile cut is not a finding, and the panel now
     * leads with the part that is one: the files in the ranking that sit inside
     * an import cycle. So the camera goes back to standing on the answer, which
     * is what it does under every other lens — 36 files here rather than 150,
     * and 21 of them in one folder, which is small enough to be a place.
     *
     * Falls back to the ranking when nothing is knotted, because on a repository
     * with no cycles the ranking is all the lens has to show.
     *
     * `shown` keeps the densest folder's files drawn around it, so any ratio the
     * reading states has something on screen to be a ratio of.
     */
    /**
     * Everything the knot touches, drawn — including the files in those cycles
     * that the ranking never reached.
     *
     * The scene mounts an edge only when both of its ends are mounted, so
     * leaving them out does not thin the tangle, it cuts it: measured on dub,
     * the knot's 273 imports hang off 109 files, only 51 of which the ranking
     * and the densest folder had already put on screen. 138 of the 273 would
     * have drawn. Half a cycle drawn is not a cycle, it is a claim the picture
     * cannot support.
     *
     * They arrive without heat, so `nodeInk` recedes them, which is right: the
     * cycle is larger than the part of it under pressure, and saying so is the
     * honest version of "36 of the 150 sit inside an import cycle".
     */
    const knot = knotOf(data)
    const tied = new Set<string>()
    for (const e of data.edges) {
      if (!knot.edges.has(e.id)) continue
      tied.add(e.source)
      tied.add(e.target)
    }

    /**
     * Each component gathered onto itself, at the place it already occupies.
     *
     * Drawing the knot's imports made the map worse before this: its members
     * are scattered by the whole-graph layout, which answers to their hundreds
     * of external imports as well, so every internal one came out as a red line
     * crossing the canvas. `scene/knot.ts` carries the measurement that ruled
     * out a ring and the argument for settling each component alone instead.
     *
     * Placed on its own centroid rather than anywhere chosen, so the knot
     * appears where the reader last saw those files rather than teleporting to
     * the middle of the scene.
     */
    const knotAt = new Map<string, Vec3>()
    for (const members of knot.components) {
      const here = members.map((id) => positions.get(id)).filter((p): p is Vec3 => Boolean(p))
      if (here.length === 0) continue
      const centre: Vec3 = [0, 1, 2].map((k) =>
        here.reduce((a, p) => a + p[k]! / here.length, 0),
      ) as unknown as Vec3
      const inside = data.edges.filter((e) => knot.edges.has(e.id))
      for (const [id, at] of layOutKnot(members, inside, centre).at) knotAt.set(id, at)
    }
    // every reader of a position has to see the same map, the camera included
    const placed = knotAt.size > 0 ? new Map([...positions, ...knotAt]) : positions
    const densest = densestFolder(data)
    const shown =
      densest || tied.size > 0 ? new Set([...(densest?.ids ?? []), ...heat.keys(), ...tied]) : null
    // frame what is drawn as the answer, and fall back the way the reading does
    const answer =
      tied.size > 0 ? [...tied] : knot.files.size > 0 ? [...knot.files] : [...heat.keys()]
    const framed = reachOf(answer, placed, vantage?.dir)
    set({
      ...noLens(),
      ...(shown ? viewOf(shown, data, placed, vantage?.dir) : {}),
      extent: framed.across * FRAME_WHOLE,
      depth: framed.deep * FRAME_WHOLE,
      focusTarget: framed.at,
      viewCentre: framed.at,
      savedVantage: vantage,
      lens: "hotspots",
      hotspotHeat: heat,
      hotspotKnot: knot.files,
      hotspotKnotEdges: knot.edges,
      hotspotKnotAt: knotAt,
      hotspotStartedAt: knotAt.size > 0 ? performance.now() : 0,
    })
  },

  pickHotspot: (id) => {
    const state = get()
    const { adjacency, hotspotHeat } = state
    // through the override: a row clicked has to fly to where its file is drawn
    const at = positionOf(state, id)
    if (!at || !hotspotHeat.has(id)) return
    /**
     * Reading a row is not choosing a new subject, which is why this is not
     * `select`.
     *
     * `select` spreads `noLens()` — a new selection invalidates the lens that
     * was answering about the old one, which is right for every lens that
     * answers *about a file*. This one answers about the codebase, so the
     * ranking is still the answer after a click; and `select` would also
     * recompute `nearby` from the file's neighbourhood, which would take the
     * other hundred and fifty answers off the screen.
     *
     * `extent` is left alone on purpose: the camera re-aims without coming
     * closer, so following the list pans across the ranking rather than diving
     * in and out of it. `esc` drops the lens and hands the file to the
     * inspector, which is where the details live.
     */
    set({
      selectedId: id,
      selectedEdgeId: null,
      litSet: computeLit({ adjacency }, id),
      selectedAt: performance.now(),
      focusTarget: at,
      cleared: null,
    })
  },

  pathNodes: [],
  pathEdges: new Set(),
  tracePathTo: (targetId) => {
    const { selectedId, imports, importers, data } = get()
    if (!selectedId || selectedId === targetId) return

    // shortest path, following imports in either direction
    const prev = new Map<string, string>()
    const seen = new Set([selectedId])
    let frontier = [selectedId]
    let found = false
    while (frontier.length > 0 && !found) {
      const next: string[] = []
      for (const id of frontier) {
        const neighbours = [...(imports.get(id) ?? []), ...(importers.get(id) ?? [])]
        for (const n of neighbours) {
          if (seen.has(n)) continue
          seen.add(n)
          prev.set(n, id)
          if (n === targetId) {
            found = true
            break
          }
          next.push(n)
        }
        if (found) break
      }
      frontier = next
    }
    if (!found) {
      const label = (id: string) => data?.nodes.find((n) => n.id === id)?.label ?? id
      toast((t) => t.toastNoPath(label(selectedId), label(targetId)))
      set(noLens())
      return
    }

    const chain: string[] = [targetId]
    let cursor = targetId
    while (cursor !== selectedId) {
      cursor = prev.get(cursor)!
      chain.unshift(cursor)
    }
    const edgeIds = new Set<string>()
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i]!
      const b = chain[i + 1]!
      const edge = data?.edges.find(
        (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
      )
      if (edge) edgeIds.add(edge.id)
    }
    set({ ...noLens(), lens: "path", pathNodes: chain, pathEdges: edgeIds })
  },

  showClusters: true,
  toggleClusters: () => set({ showClusters: !get().showClusters }),

  showLabels: true,
  toggleLabels: () => set({ showLabels: !get().showLabels }),

  edgeFilter: null,
  cycleEdgeFilter: () => {
    const next =
      EDGE_FILTER_CYCLE[
        (EDGE_FILTER_CYCLE.indexOf(get().edgeFilter) + 1) % EDGE_FILTER_CYCLE.length
      ]!
    // an edge selected under the old filter may no longer be visible
    set({ edgeFilter: next, selectedEdgeId: null })
  },

  pngRequested: false,
  requestPng: () => set({ pngRequested: true }),
  clearPng: () => set({ pngRequested: false }),

  moveNode: (id, pos) => {
    const positions = new Map(get().positions)
    positions.set(id, pos)
    // placing a node by hand freezes it: a re-parse must not undo the gesture
    const pinned = new Set(get().pinned)
    pinned.add(id)
    set({ positions, pinned })
  },

  pinned: new Set(),
  isDemo: false,

  arrivedAt: 0,
  playArrival: () => set({ arrivedAt: performance.now() }),

  timeline: null,
  replay: null,
  frameIndex: 0,
  present: null,
  frameAdded: new Set(),
  frameRemoved: new Set(),
  // a generated replay is merely *available*; entering it is a deliberate act,
  // so the present stays the default view and only one source loads the graph
  loadTimeline: (t) => set({ timeline: t, replay: replayOf(t) }),
  enterReplay: () => {
    const { timeline, present, data } = get()
    if (!timeline) return
    // remember where we were, so esc can put the present back
    set({ ...noLens(), lens: "replay", present: present ?? data })
    // start at the origin: a replay is meant to be watched growing, and
    // opening on the last frame shows exactly what you just left
    get().showFrame(0)
  },
  exitReplay: () => {
    const { present } = get()
    set({ ...noLens(), frameAdded: new Set(), frameRemoved: new Set() })
    if (present) get().load(present)
    set({ present: null })
  },
  showFrame: (index) => {
    const { timeline, replay, load } = get()
    const frame = timeline?.frames[index]
    if (!frame || !replay) return
    /**
     * Rebuilt from the first frame and the changes since: a frame no longer
     * carries the whole architecture, and forty copies of the same three
     * thousand files was most of what a replay used to weigh.
     */
    const graph = replay.at(index)
    if (!graph) return
    // load() seeds the layout from the previous positions, so a file that
    // survives this commit keeps its place instead of jumping
    load(graph)
    set({
      lens: "replay",
      frameIndex: index,
      frameAdded: new Set(frame.added),
      frameRemoved: new Set(frame.removed),
    })
  },

  lens: "none",
  clearLens: () => set({ ...noLens(), ...get().restoreView() }),
  whatIf: null,
  whatIfOrphaned: new Set(),
  whatIfBroken: new Set(),
  toggleWhatIf: () => {
    const { whatIf, selectedId, data } = get()
    if (whatIf) {
      set(noLens())
      return
    }
    if (!selectedId || !data) {
      toast((t) => t.toastNeedsSelection("What if"))
      return
    }
    const report = simulateDelete(data, selectedId, data.rules)
    if (!report) return
    set({
      ...noLens(),
      lens: "whatif",
      whatIf: report,
      whatIfOrphaned: new Set(report.orphaned),
      whatIfBroken: new Set(report.broken),
    })
  },

  districtMode: false,
  setDistrictMode: (v) => {
    if (get().districtMode === v) return
    // leaving the file level drops anything that referred to a single file
    set(
      v
        ? {
            districtMode: true,
            hoverId: null,
            selectedId: null,
            selectedEdgeId: null,
            litSet: new Set(),
            ...noLens(),
          }
        : { districtMode: false },
    )
  },

  nearby: null,
  skeletonSet: null,
  traffic: new Set(),
  names: new Map(),
  extent: 60,
  depth: 60,
  setNearby: (ids) => {
    const current = get().nearby
    // same membership, same render: replacing the set would remount the scene
    if (current === ids) return
    if (current && ids && current.size === ids.size) {
      let identical = true
      for (const id of ids) {
        if (current.has(id)) continue
        identical = false
        break
      }
      if (identical) return
    }
    set({ nearby: ids })
  },

  load: (data, isDemo = false) => {
    const prev = get()
    // a watch reload must not destroy hand-made work: keep the arrangement
    // and the bent curves, only new nodes get placed
    const positions = runLayout(data, { previous: prev.positions, pinned: prev.pinned })
    const adjacency = new Map<string, Set<string>>()
    const inDeg = new Map<string, number>()
    const outDeg = new Map<string, number>()
    const importers = new Map<string, Set<string>>()
    const imports = new Map<string, Set<string>>()
    for (const n of data.nodes) {
      adjacency.set(n.id, new Set())
      importers.set(n.id, new Set())
      imports.set(n.id, new Set())
      inDeg.set(n.id, 0)
      outDeg.set(n.id, 0)
    }
    const ctrl = new Map<string, { c1: Vec3; c2: Vec3 }>()
    for (const e of data.edges) {
      adjacency.get(e.source)?.add(e.target)
      adjacency.get(e.target)?.add(e.source)
      imports.get(e.source)?.add(e.target)
      importers.get(e.target)?.add(e.source)
      outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
      // persisted curve edits ship inside the JSON…
      if (e.ctrl1 && e.ctrl2) ctrl.set(e.id, { c1: e.ctrl1, c2: e.ctrl2 })
      // …but an unsaved edit in this session wins over it
      const live = prev.ctrl.get(e.id)
      if (live) ctrl.set(e.id, live)
    }
    const violatedNodes = new Map<string, { message: string; about: boolean }[]>()
    const violatedEdges = new Map<string, string[]>()
    for (const v of data.violations ?? []) {
      for (const id of v.nodeIds) {
        // no subject means no single file is answerable, so every member is:
        // that is a cycle, and it is also what graphs parsed before this
        // distinction existed look like
        const about = v.subject === undefined || v.subject === id
        violatedNodes.set(id, [...(violatedNodes.get(id) ?? []), { message: v.message, about }])
      }
      for (const id of v.edgeIds)
        violatedEdges.set(id, [...(violatedEdges.get(id) ?? []), v.message])
    }
    // a node that disappeared from the codebase shouldn't stay pinned forever
    const alive = new Set(data.nodes.map((n) => n.id))
    const pinned = new Set([...prev.pinned].filter((id) => alive.has(id)))

    /**
     * What the detail view opens on, decided before the first render.
     *
     * A large repository opens on its skeleton, the files that hold it up, and
     * selecting one swaps that for its neighbourhood. Both are settled here so
     * the scene never mounts the whole graph even once: deciding a frame later
     * built cal.com's 25 800 draw calls and threw them away immediately.
     */
    const ids = data.nodes.map((n) => n.id)
    const traffic = impassable(ids, data.edges)
    const bones = skeleton(ids, data.edges, BUDGET)

    const { at: centre, across: extent, deep: depth } = reachOf(bones ? [...bones] : ids, positions)

    set({
      data,
      isDemo,
      positions,
      nearby: bones,
      names: disambiguate(bones ? data.nodes.filter((n) => bones.has(n.id)) : data.nodes),
      skeletonSet: bones,
      traffic,
      extent,
      depth,
      pinned,
      adjacency,
      inDeg,
      outDeg,
      ctrl,
      violatedNodes,
      violatedEdges,
      orphans: new Set(data.analysis?.orphans ?? []),
      // computed here rather than on demand because `openOnFinding` needs it a
      // few lines below anyway, and running the cycle search twice on a graph
      // this size is not free
      findings: diagnose(data),
      browsing: null,
      importers,
      imports,
      // stale interaction state must not survive a data swap (watch mode)
      hoverId: null,
      selectedId: null,
      selectedEdgeId: null,
      // A target left over from another codebase aims at coordinates that mean
      // nothing in this one, so it is replaced rather than cleared: the middle
      // of what just arrived. Cleared, the camera would keep measuring from the
      // origin while `extent` described a cloud sitting somewhere else.
      focusTarget: centre,
      viewCentre: centre,
      // and for the same reason, an angle saved over another codebase means
      // nothing here
      focusDir: null,
      savedVantage: null,
      litSet: new Set(),
      ...noLens(),
    })

    /**
     * Open on a question rather than on a graph, so the reader has somewhere to
     * stand. Only for graphs that already needed a skeleton: a small one shows
     * everything at once and has nothing to lead with.
     */
    if (bones) get().openOnFinding()
  },

  openOnFinding: () => {
    const { data, skeletonSet, adjacency } = get()
    if (!data || !skeletonSet) return

    /**
     * The biggest finding is rarely the one worth opening on.
     *
     * cal.com's is a 106-file loop through generated Prisma models: the largest
     * by a distance, and architecture nobody wrote. Not one of those files
     * survives the peeling that leaves the skeleton, while the cycle a reader
     * should care about (`getCalendar -> CalendarSubscriptionService -> ...`)
     * is 87% load-bearing. So the skeleton picks the question and the ranking
     * only orders what is left.
     */
    const worth = get().findings.find(
      (f) => f.kind === "cycle" && f.nodeIds.some((id) => skeletonSet.has(id)),
    )
    if (!worth) return

    // stand where the most of it is visible at once
    const focus = worth.nodeIds
      .filter((id) => skeletonSet.has(id))
      .sort(
        (a, b) =>
          (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b),
      )[0]
    if (!focus) return
    get().select(focus)

    /**
     * Frame the answer, not the repository. `extent` was measured over the
     * skeleton, some four hundred units across, and the neighbourhood is a
     * fraction of that, so the scene showed a thumbnail in an empty frame.
     *
     * Only on the opening move: re-framing on every later click would take the
     * camera out of the reader's hands.
     */
    const { nearby, positions, vantage } = get()
    if (!nearby) return
    const { at, across, deep } = reachOf([...nearby], positions, vantage?.dir)
    set({ extent: across, depth: deep, focusTarget: at, viewCentre: at })
  },

  setHover: (id) => {
    const { selectedId, adjacency } = get()
    // selection wins over hover for the lit neighbourhood
    const active = id ?? selectedId
    set({ hoverId: id, litSet: computeLit({ adjacency }, active) })
  },

  select: (id) => {
    const { adjacency, data, skeletonSet, traffic } = get()
    /**
     * Selecting a file answers with what it talks to, out to two hops: on
     * cal.com the median file reaches 32 others that way, and the few that
     * would reach hundreds do it through the same handful of universal
     * utilities, which are drawn but not travelled through.
     */
    const nearby =
      id && skeletonSet && data
        ? fittingNeighbourhood(id, data.edges, traffic, READABLE)
        : skeletonSet
    set({
      selectedId: id,
      selectedEdgeId: null,
      // two files can share a basename without sharing a screen; qualify only
      // the ones that now do
      // the same measure the way back uses: a selection framed around its
      // middle and restored across the view would land somewhere new on every
      // round trip, which the round-trip test in `graph.test.ts` now catches
      ...viewOf(nearby, data, get().positions, get().vantage?.dir),
      litSet: computeLit({ adjacency }, id),
      selectedAt: performance.now(),
      // choosing something else is moving on: the offer to take back the last
      // deselection would otherwise sit there and jump the reader backwards
      cleared: null,
      // a new selection invalidates whatever lens was answering about the old one
      ...noLens(),
    })
  },

  selectEdge: (id) => {
    if (!id) {
      set({ selectedEdgeId: null })
      return
    }
    const { data, adjacency } = get()
    const edge = data?.edges.find((e) => e.id === id)
    const lit = new Set<string>()
    if (edge) {
      lit.add(edge.source)
      lit.add(edge.target)
    }
    void adjacency
    set({ selectedEdgeId: id, selectedId: null, litSet: lit })
  },

  focus: (id) => {
    const pos = get().positions.get(id)
    if (pos) set({ focusTarget: pos })
  },

  // back to the opening shot, which is the middle of what is drawn and not
  // the origin: the two are the same only on a graph that happens to be centred
  resetCamera: () => set({ focusTarget: get().viewCentre }),
  // the asked-for side is spent with the flight that honoured it: left standing,
  // it would drag the next flight — one going somewhere new — back to it
  clearFocus: () => set({ focusTarget: null, focusDir: null }),
  setControlsEnabled: (v) => set({ controlsEnabled: v }),

  setCtrl: (edgeId, c1, c2) => {
    const ctrl = new Map(get().ctrl)
    ctrl.set(edgeId, { c1, c2 })
    set({ ctrl })
  },

  resetCtrl: (edgeId) => {
    const ctrl = new Map(get().ctrl)
    ctrl.delete(edgeId)
    set({ ctrl })
  },

  /**
   * Letting go of a file gives the map back.
   *
   * This used to drop the selection and leave `nearby` narrowed, so escape and
   * a click on the background both landed on 65 files of 3547, unlit, with the
   * camera still on a knot that was no longer the subject. Nothing widened it
   * again, so the only way back to the map was a reload. `select` already knew
   * how, but `select(null)` was never called from anywhere.
   *
   * The camera comes back only when the view was actually narrowed: clicking
   * the background is also how people find out nothing was selected.
   */
  clear: () => {
    const { skeletonSet, nearby, data, positions, selectedId, lens, vantage } = get()
    const widened = nearby !== skeletonSet
    // the offer and the notice carrying it are the same thing: where nothing
    // can present one, nothing is remembered either
    const cleared = selectedId && get().toastsMounted ? { selectedId, lens, vantage } : null
    if (cleared) {
      const label = get().names.get(selectedId!) ?? selectedId!
      toast((t) => {
        t.toastDeselected(label, selectedId!, () => get().restoreCleared())
        // the offer expires with the toast that carries it: an undo that
        // outlives its own notice is a history stack, and a reader would have
        // no way of knowing how far back it reaches
        setTimeout(() => {
          if (get().cleared === cleared) set({ cleared: null })
        }, t.UNDO_MS)
      })
    }
    const rest = {
      hoverId: null,
      selectedId: null,
      selectedEdgeId: null,
      litSet: new Set<string>(),
      cleared,
      ...noLens(),
      // the map is not a return: nothing is owed the angle a lens was keeping
      focusDir: null,
      savedVantage: null,
    }
    if (!widened || !data) {
      set({ ...rest, focusTarget: null })
      return
    }
    const ids = skeletonSet ? [...skeletonSet] : data.nodes.map((n) => n.id)
    const { at, across, deep } = reachOf(ids, positions, vantage?.dir)
    set({
      ...rest,
      nearby: skeletonSet,
      // the qualifiers described who shared the screen, and that has changed
      names: disambiguate(
        skeletonSet ? data.nodes.filter((n) => skeletonSet.has(n.id)) : data.nodes,
      ),
      extent: across,
      depth: deep,
      // fly back rather than cut: letting go should undo the arrival
      focusTarget: at,
    })
  },

  /**
   * Take the deselection back: the file, its lens, and the spot it was read
   * from. Replayed through the store's own actions for the reason `applyView`
   * gives, so an undo inherits their guards.
   *
   * `path` and `replay` are not reopened: a path is a chain the reader built,
   * more than a deselection threw away, and the replay survives `clear()`.
   */
  restoreCleared: () => {
    const cleared = get().cleared
    if (!cleared) return
    set({ cleared: null })
    get().select(cleared.selectedId)
    if (cleared.lens === "impact") get().toggleImpact()
    else if (cleared.lens === "whatif") get().toggleWhatIf()
    // last: the selection and the lens each framed themselves on the way past,
    // and where the reader was actually standing outranks both
    if (cleared.vantage) {
      set({ focusTarget: cleared.vantage.at, focusDir: cleared.vantage.dir })
    }
  },

  /**
   * A click on nothing, as reported by the canvas.
   *
   * Not `clear()` directly. R3F decides a click "missed" on the `click` event,
   * with a fresh raycast, one event after `NodeMesh` commits the selection on
   * `pointerup`, and it fires whenever that second raycast comes back empty
   * anywhere in the scene. `stopPropagation` cannot prevent it: the test runs
   * at the canvas, before any handler, on an event the node never sees.
   *
   * Why the ray comes back empty is unsettled; `PanelOffset` shifting the
   * projection by 150px inside the same gesture is the leading candidate. It
   * need not be settled — one gesture must not both select and deselect. `esc`
   * is not guarded: dropping a selection you just made is a thing you can mean.
   */
  clearFromBackground: () => {
    // pointerup and click land within a few ms of each other; nothing a person
    // does on purpose lands this close to their own last selection
    if (performance.now() - get().selectedAt < 150) return
    get().clear()
  },
}))

/**
 * The graph as it looks right now, curves and layout included, in the
 * trame.json shape, so reopening restores the composition.
 */
export function currentGraph(): GraphData | null {
  const { data, ctrl, positions } = useGraphStore.getState()
  if (!data) return null
  const edges = data.edges.map((e) => {
    const c = ctrl.get(e.id)
    return c ? { ...e, ctrl1: c.c1, ctrl2: c.c2 } : e
  })
  const nodes = data.nodes.map((n) => {
    const p = positions.get(n.id)
    return p ? { ...n, x: p[0], y: p[1], z: p[2] } : n
  })
  return { ...data, nodes, edges }
}

export function exportGraph(): string | null {
  const graph = currentGraph()
  return graph ? JSON.stringify(graph, null, 2) : null
}
