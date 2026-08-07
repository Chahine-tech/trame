import { create } from "zustand"
import type { EdgeType, GraphData, Vec3 } from "../types"
import { runLayout } from "../scene/Layout"
import { toastNeedsSelection, toastNoPath } from "../ui/toast"

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

  /** zoomed out far enough that folders stand in for their files */
  districtMode: boolean
  setDistrictMode: (v: boolean) => void

  load: (data: GraphData, isDemo?: boolean) => void
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
      set({ impactOf: null, impactDepth: new Map() })
      return
    }
    if (!selectedId) {
      toastNeedsSelection("Impact")
      return
    }
    // BFS up the importer graph — everything that would break
    const depth = new Map<string, number>([[selectedId, 0]])
    let frontier = [selectedId]
    let d = 0
    while (frontier.length > 0) {
      d++
      const next: string[] = []
      for (const id of frontier) {
        for (const importer of importers.get(id) ?? []) {
          if (depth.has(importer)) continue
          depth.set(importer, d)
          next.push(importer)
        }
      }
      frontier = next
    }
    set({
      impactOf: selectedId,
      impactDepth: depth,
      impactStartedAt: performance.now(),
      pathNodes: [],
      pathEdges: new Set(),
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
      toastNoPath(label(selectedId), label(targetId))
      set({ pathNodes: [], pathEdges: new Set() })
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
    set({ pathNodes: chain, pathEdges: edgeIds, impactOf: null, impactDepth: new Map() })
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
            impactOf: null,
            impactDepth: new Map(),
            pathNodes: [],
            pathEdges: new Set(),
          }
        : { districtMode: false },
    )
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

    set({
      data,
      isDemo,
      positions,
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
      litSet: new Set(),
      impactOf: null,
      impactDepth: new Map(),
      pathNodes: [],
      pathEdges: new Set(),
    })
  },

  setHover: (id) => {
    const { selectedId, adjacency } = get()
    // selection wins over hover for the lit neighbourhood
    const active = id ?? selectedId
    set({ hoverId: id, litSet: computeLit({ adjacency }, active) })
  },

  select: (id) => {
    const { adjacency } = get()
    set({
      selectedId: id,
      selectedEdgeId: null,
      litSet: computeLit({ adjacency }, id),
      // a new selection invalidates any impact/path overlay
      impactOf: null,
      impactDepth: new Map(),
      pathNodes: [],
      pathEdges: new Set(),
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
      impactOf: null,
      impactDepth: new Map(),
      pathNodes: [],
      pathEdges: new Set(),
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
