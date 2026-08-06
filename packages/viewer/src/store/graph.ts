import { create } from "zustand"
import type { GraphData, Vec3 } from "../types"
import { runLayout } from "../scene/Layout"

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

  load: (data: GraphData) => void
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

  load: (data) => {
    const positions = runLayout(data)
    const adjacency = new Map<string, Set<string>>()
    const inDeg = new Map<string, number>()
    const outDeg = new Map<string, number>()
    for (const n of data.nodes) {
      adjacency.set(n.id, new Set())
      inDeg.set(n.id, 0)
      outDeg.set(n.id, 0)
    }
    const ctrl = new Map<string, { c1: Vec3; c2: Vec3 }>()
    for (const e of data.edges) {
      adjacency.get(e.source)?.add(e.target)
      adjacency.get(e.target)?.add(e.source)
      outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
      // persisted curve edits ship inside the JSON
      if (e.ctrl1 && e.ctrl2) ctrl.set(e.id, { c1: e.ctrl1, c2: e.ctrl2 })
    }
    set({ data, positions, adjacency, inDeg, outDeg, ctrl })
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
    set({ hoverId: null, selectedId: null, selectedEdgeId: null, litSet: new Set(), focusTarget: null }),
}))

/** Serialize current data + curve edits back to the archviz.json schema. */
export function exportGraph(): string | null {
  const { data, ctrl } = useGraphStore.getState()
  if (!data) return null
  const edges = data.edges.map((e) => {
    const c = ctrl.get(e.id)
    return c ? { ...e, ctrl1: c.c1, ctrl2: c.c2 } : e
  })
  return JSON.stringify({ ...data, edges }, null, 2)
}
