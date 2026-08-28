export type NodeType =
  | "page"
  | "component"
  | "hook"
  | "api"
  | "query-key"
  | "context"
  | "store"
  | "module"

export type EdgeType = "import" | "api-call" | "query-key" | "component" | "context"

export type DiffStatus = "same" | "added" | "removed"

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  file: string
  line: number
  cluster: string
  diff?: DiffStatus
  /** persisted layout position, written by the viewer's export */
  x?: number
  y?: number
  z?: number
  meta?: {
    queryKey?: string
    endpoint?: string
    method?: string
  }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  diff?: DiffStatus
  ctrl1?: [number, number, number]
  ctrl2?: [number, number, number]
}

export interface GraphCluster {
  id: string
  label: string
  color: string
  nodeIds: string[]
}

export interface Violation {
  rule: "unique-caller" | "no-direct-import" | "no-cycles"
  message: string
  nodeIds: string[]
  edgeIds: string[]
}

export interface RuleMatch {
  edgeType?: EdgeType
  sourceType?: NodeType
  targetType?: NodeType
}

export interface Rule {
  type: "unique-caller" | "no-direct-import" | "no-cycles"
  match?: RuleMatch
  message: string
}

export interface Analysis {
  orphans: string[]
  cycles: string[][]
}

export interface GraphData {
  meta: {
    project: string
    generated: string
    nodeCount: number
    edgeCount: number
    /**
     * Absolute path the node paths hang off, so a file can be opened locally.
     *
     * Absent on a graph somebody else parsed and published, which is the point:
     * one field carries the shape of the machine that produced the graph, so one
     * field can be dropped to anonymise it.
     */
    root?: string
    /** watch mode: last parse failed, this graph is the last good one */
    error?: string
  }
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
  violations?: Violation[]
  analysis?: Analysis
  /** rules shipped by the parser so "what if?" can re-evaluate them here */
  rules?: Rule[]
  /** pairs the history couples that no import connects; absent outside a repo */
  coChange?: CoChange[]
  diff?: {
    addedNodes: number
    removedNodes: number
    addedEdges: number
    removedEdges: number
  }
}

export type Vec3 = [number, number, number]

/**
 * One commit's worth of change, enough to rebuild a frame from the one before.
 *
 * Additions and removals are the obvious part. Changes are not: a file that
 * stays put can still move to another line, get renamed, or stop being a module
 * and start being a component, and that one is drawn, since type decides a
 * node's shape and colour.
 */
export interface FrameDelta {
  addedNodes: GraphNode[]
  changedNodes: GraphNode[]
  removedNodes: string[]
  addedEdges: GraphEdge[]
  changedEdges: GraphEdge[]
  removedEdges: string[]
}

export interface ReplayFrame {
  sha: string
  date: string
  subject: string
  author: string
  nodeCount: number
  edgeCount: number
  added: string[]
  removed: string[]
  violations: number
  cycles: number
  /**
   * The whole architecture, on the first frame, and on every frame of a
   * replay generated before the format carried differences, which still reads.
   */
  graph?: GraphData
  /** what this commit changed, for every frame after the first */
  delta?: FrameDelta
}

export interface Timeline {
  meta: {
    project: string
    generated: string
    frameCount: number
    from: string
    to: string
  }
  frames: ReplayFrame[]
}

/**
 * Two files the history keeps changing together that no import connects.
 *
 * Mirrors the parser's declaration. The two files are not connected by an
 * import in either direction — which the tool itself reports as a co-change
 * pair, and it is right: they have to be edited together and nothing says so.
 */
export interface CoChange {
  a: string
  b: string
  /** commits in the window that touched both */
  together: number
  /** together / (touched a or b), so a file that changes with everything scores low */
  jaccard: number
}
