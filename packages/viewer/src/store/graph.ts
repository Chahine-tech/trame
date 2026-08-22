import { create } from "zustand"
import type { EdgeType, GraphData, Timeline, Vec3 } from "../types"
import { runLayout } from "../scene/Layout"
import { BUDGET, READABLE } from "../scene/budget"
import { fittingNeighbourhood, impassable, skeleton } from "../scene/skeleton"
import { disambiguate } from "../scene/names"
import { diagnose } from "tramejs/doctor"
import { simulateDelete, type WhatIfReport } from "./whatif"
import { replayOf, type Replay } from "./timeline"
import type { LensKind } from "./lens"

/**
 * Toasts, fetched at the moment one is needed rather than up front.
 *
 * The toast library pulls in framer-motion — 55 kB gzip that the landing was
 * shipping in its critical chunk for messages it never shows, because the
 * store is the only thing it imports from the tool. The viewer keeps paying
 * nothing: App.tsx imports the module statically, so by the time anyone can
 * click, it is already there and this resolves from cache.
 *
 * Both call sites are user gestures, never first paint.
 */
function toast(show: (m: typeof import("../ui/toast")) => void): void {
  void import("../ui/toast").then(show)
}

/**
 * Everything that transitively reaches `from`, with the number of hops.
 *
 * The blast radius of a change: what would have to be recompiled, and how far
 * each file sits from the edit. Exported because the answer is wanted outside
 * the lens too — anything choosing a file to demonstrate on should choose it by
 * the very walk the amber wave will draw, and two walks that can drift apart
 * are one walk too many.
 *
 * `neighbours` is a direction, not a fixed map: pass `importers` for "what
 * depends on this", `adjacency` for "what is near this".
 */
export function reachable(
  neighbours: Map<string, Set<string>>,
  from: string,
): Map<string, number> {
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
  }
}

/** E cycles through: everything → each edge type → everything */
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

  /** camera focus target, consumed by the CameraRig */
  focusTarget: Vec3 | null
  /** OrbitControls gate — off while dragging a Bézier handle */
  controlsEnabled: boolean

  /** user-edited Bézier control points, by edge id */
  ctrl: Map<string, { c1: Vec3; c2: Vec3 }>

  /** rule violations — red highlighting */
  violatedNodes: Map<string, string[]>
  violatedEdges: Map<string, string[]>

  /** nodes nothing imports — likely dead code */
  orphans: Set<string>

  /** directed adjacency, for impact and path queries */
  importers: Map<string, Set<string>>
  imports: Map<string, Set<string>>

  /** "if I change this, what breaks?" — depth per transitive dependent (I) */
  impactOf: string | null
  impactDepth: Map<string, number>
  /** when the current impact query started — drives the ring-by-ring reveal */
  impactStartedAt: number
  toggleImpact: () => void

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

  /** edge type filter (E cycles) — null shows everything */
  edgeFilter: EdgeType | null
  cycleEdgeFilter: () => void

  /** PNG export request, consumed by the in-canvas capture helper (⌘E) */
  pngRequested: boolean
  requestPng: () => void
  clearPng: () => void

  /** reposition a node (drag) — connected edges follow */
  moveNode: (id: string, pos: Vec3) => void
  /** nodes the user placed by hand — frozen out of the simulation */
  pinned: Set<string>

  /** true when no trame.json was served and the demo graph stands in */
  isDemo: boolean

  /**
   * When the current graph started arriving, or 0 to skip the entrance.
   *
   * The landing turns this on so the graph assembles itself in front of the
   * visitor; the tool leaves it off, because someone who just saved a file
   * wants their architecture back, not a performance.
   */
  arrivedAt: number
  playArrival: () => void

  /** zoomed out far enough that folders stand in for their files */
  districtMode: boolean
  setDistrictMode: (v: boolean) => void

  /**
   * Which files the detail view is allowed to draw — `null` when the whole
   * graph fits and nothing needs holding back.
   *
   * Districts already stand in for files from a distance, but stepping inside
   * used to mount every node and every edge in the repository. On cal.com that
   * is 3451 files and 9458 imports, around 25 800 draw calls, and the scene
   * stopped being either fast or readable. Measured on that graph: 500 files
   * are comfortable, 1000 are neither.
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
   * Every camera distance in the scene used to be a number written for a graph
   * the size of trame's own — start at 80, collapse to districts past 115, never
   * pull back beyond 220. cal.com's skeleton reaches 402, so all four sat inside
   * the cloud and there was no way to rise above the map. They are ratios of
   * this now, and the ratios are the ones trame was already using.
   */
  extent: number

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

  /** which question the colours are currently answering — only one at a time */
  lens: LensKind
  /** drop the lens but keep the selection: esc walks back one step at a time */
  clearLens: () => void

  /** "what if I deleted this?" — the consequences, computed but not applied */
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
 * Every camera distance is a multiple of the spread, so it has to describe what
 * is on screen rather than what exists — and measured from the middle of that,
 * not from the origin. A neighbourhood is a knot somewhere off to one side; its
 * distance *from the origin* says how far away it is, which is not the same
 * question as how big it is, and answering the wrong one framed a thumbnail in
 * an empty screen. The percentile rather than the maximum, because one stray
 * file should not push the camera into orbit.
 */
function reachOf(
  ids: string[],
  positions: Map<string, Vec3>,
): { at: Vec3; spread: number } {
  const points = ids.map((id) => positions.get(id)).filter((p): p is Vec3 => Boolean(p))
  if (points.length === 0) return { at: [0, 0, 0], spread: 60 }

  const at: Vec3 = [0, 0, 0]
  for (const p of points) {
    at[0] += p[0] / points.length
    at[1] += p[1] / points.length
    at[2] += p[2] / points.length
  }
  const radii = points
    .map((p) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]))
    .sort((a, b) => a - b)
  /**
   * Frame everything, unless one file has wandered absurdly far.
   *
   * Trimming the outermost tenth was the first attempt: it keeps a stray among
   * three thousand from pushing the camera into orbit, and on the forty files
   * around a selection it quietly dropped four of them off the screen — one of
   * them a hub, cut in half at the left margin. Framing to the very furthest is
   * no better: cal.com's cancellation neighbourhood runs to 81 at the median
   * and 187 at the ninety-fifth, with a single file out at 323, and letting
   * that one file decide would shrink the other thirty-nine by half.
   *
   * So the whole set counts, up to a few times the middle of it. Nothing is
   * excluded for being merely far — only for being out of all proportion.
   */
  const median = radii[Math.floor(radii.length / 2)] ?? 60
  const furthest = radii[radii.length - 1] ?? 60
  return { at, spread: Math.max(40, Math.min(furthest, median * 2.5)) }
}

function computeLit(state: Pick<GraphState, "adjacency">, id: string | null): Set<string> {
  const lit = new Set<string>()
  if (!id) return lit
  lit.add(id)
  for (const n of state.adjacency.get(id) ?? []) lit.add(n)
  return lit
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
  controlsEnabled: true,

  ctrl: new Map(),

  violatedNodes: new Map(),
  violatedEdges: new Map(),

  orphans: new Set(),

  importers: new Map(),
  imports: new Map(),

  impactOf: null,
  impactDepth: new Map(),
  impactStartedAt: 0,
  toggleImpact: () => {
    const { selectedId, impactOf, importers } = get()
    if (impactOf) {
      set(noLens())
      return
    }
    if (!selectedId) {
      toast((t) => t.toastNeedsSelection("Impact"))
      return
    }
    // everything that would break, and how far from the change it sits
    const depth = reachable(importers, selectedId)
    set({
      ...noLens(),
      lens: "impact",
      impactOf: selectedId,
      impactDepth: depth,
      impactStartedAt: performance.now(),
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
      EDGE_FILTER_CYCLE[(EDGE_FILTER_CYCLE.indexOf(get().edgeFilter) + 1) % EDGE_FILTER_CYCLE.length]!
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
     * Rebuilt from the first frame and the changes since, because a frame no
     * longer carries the whole architecture — forty copies of the same three
     * thousand files is most of what a replay used to weigh.
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
  clearLens: () => set(noLens()),
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
    const violatedNodes = new Map<string, string[]>()
    const violatedEdges = new Map<string, string[]>()
    for (const v of data.violations ?? []) {
      for (const id of v.nodeIds) violatedNodes.set(id, [...(violatedNodes.get(id) ?? []), v.message])
      for (const id of v.edgeIds) violatedEdges.set(id, [...(violatedEdges.get(id) ?? []), v.message])
    }
    // a node that disappeared from the codebase shouldn't stay pinned forever
    const alive = new Set(data.nodes.map((n) => n.id))
    const pinned = new Set([...prev.pinned].filter((id) => alive.has(id)))

    /**
     * What the detail view opens on, decided before the first render.
     *
     * A large repository opens on its skeleton — the files that hold it up —
     * rather than on whichever four hundred happened to sit near the camera.
     * Selecting a file then swaps the skeleton for that file's neighbourhood.
     * Both are settled here so the scene never mounts the whole graph even
     * once: deciding a frame later meant building cal.com's 25 800 draw calls
     * and throwing them away in the same breath.
     */
    const ids = data.nodes.map((n) => n.id)
    const traffic = impassable(ids, data.edges)
    const bones = skeleton(ids, data.edges, BUDGET)

    const extent = reachOf(bones ? [...bones] : ids, positions).spread

    set({
      data,
      isDemo,
      positions,
      nearby: bones,
      names: disambiguate(bones ? data.nodes.filter((n) => bones.has(n.id)) : data.nodes),
      skeletonSet: bones,
      traffic,
      extent,
      pinned,
      adjacency,
      inDeg,
      outDeg,
      ctrl,
      violatedNodes,
      violatedEdges,
      orphans: new Set(data.analysis?.orphans ?? []),
      importers,
      imports,
      // stale interaction state must not survive a data swap (watch mode)
      hoverId: null,
      selectedId: null,
      selectedEdgeId: null,
      // including where the camera was pointed: a target left over from another
      // codebase aims it at coordinates that mean nothing in this one
      focusTarget: null,
      litSet: new Set(),
      ...noLens(),
    })

    /**
     * Open on a question rather than on a graph.
     *
     * A repository too big to draw whole is also too big to *read* whole, so
     * landing on all of it asks the reader to find their own way in. Landing on
     * the worst thing the codebase is actually doing gives them somewhere to
     * stand — and the neighbourhood view answers it immediately.
     *
     * Only for graphs that already needed a skeleton: a small one shows
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
     * cal.com's is a 106-file loop through generated Prisma models — the
     * largest by a distance, and architecture nobody wrote. Not one of those
     * files survives the peeling that leaves the skeleton, while the cycle a
     * reader should care about (`getCalendar → CalendarSubscriptionService →
     * …`) is 87% load-bearing. So the skeleton picks the question, and the
     * ranking only orders what is left.
     */
    const worth = diagnose(data).find(
      (f) => f.kind === "cycle" && f.nodeIds.some((id) => skeletonSet.has(id)),
    )
    if (!worth) return

    // stand where the most of it is visible at once
    const focus = worth.nodeIds
      .filter((id) => skeletonSet.has(id))
      .sort(
        (a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b),
      )[0]
    if (!focus) return
    get().select(focus)

    /**
     * Frame the answer, not the repository.
     *
     * The camera works in multiples of `extent`, which was measured over the
     * skeleton — some four hundred units across. The neighbourhood it has just
     * opened on is a tight knot a fraction of that, so left alone the scene
     * showed a thumbnail adrift in an empty frame. Only on the opening move:
     * re-framing on every later click would snatch the camera out of the
     * reader's hands.
     */
    const { nearby, positions } = get()
    if (!nearby) return
    const { at, spread } = reachOf([...nearby], positions)
    set({ extent: spread, focusTarget: at })
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
     * Selecting a file is asking about it, so answer with what it talks to.
     *
     * Two hops: on cal.com the median file reaches 32 others that way, and the
     * few that would reach hundreds do it through the same handful of universal
     * utilities, which are drawn but not travelled through. Letting go of the
     * selection puts the skeleton back — the map you came from.
     */
    const nearby =
      id && skeletonSet && data
        ? fittingNeighbourhood(id, data.edges, traffic, READABLE)
        : skeletonSet
    set({
      selectedId: id,
      selectedEdgeId: null,
      nearby,
      // two files can share a basename without sharing a screen; qualify only
      // the ones that now do
      names: disambiguate(nearby && data ? data.nodes.filter((n) => nearby.has(n.id)) : (data?.nodes ?? [])),
      litSet: computeLit({ adjacency }, id),
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

  resetCamera: () => set({ focusTarget: [0, 0, 0] }),
  clearFocus: () => set({ focusTarget: null }),
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

  clear: () =>
    set({
      hoverId: null,
      selectedId: null,
      selectedEdgeId: null,
      litSet: new Set(),
      focusTarget: null,
      ...noLens(),
    }),
}))

/**
 * The graph as it looks right now — curves you bent and the layout you
 * arranged — in the trame.json shape, so reopening restores your composition.
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
