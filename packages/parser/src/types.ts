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

/** Set only in diff mode — how this item changed between base and head. */
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
  /** Persisted Bézier control points (saved after user edits) */
  ctrl1?: [number, number, number]
  ctrl2?: [number, number, number]
}

export interface GraphCluster {
  id: string
  label: string
  color: string
  nodeIds: string[]
}

export interface GraphData {
  meta: {
    project: string
    generated: string
    nodeCount: number
    edgeCount: number
    /** watch mode: last parse failed, this graph is the last good one */
    error?: string
  }
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
  violations?: Violation[]
  analysis?: Analysis
  /** the rules that produced `violations` — shipped so the viewer can re-run
   *  them on a hypothetical graph ("what if I deleted this?") */
  rules?: Rule[]
  diff?: {
    addedNodes: number
    removedNodes: number
    addedEdges: number
    removedEdges: number
  }
}


export interface RuleMatch {
  edgeType?: EdgeType
  sourceType?: NodeType
  targetType?: NodeType
}

export interface Rule {
  /** unique-caller: a matched target may have only one matching caller.
   *  no-direct-import: any matching edge is a violation.
   *  no-cycles: no circular dependency between files. */
  type: "unique-caller" | "no-direct-import" | "no-cycles"
  match?: RuleMatch
  message: string
}

export interface TrameConfig {
  rules?: Rule[]
}

export interface Violation {
  rule: Rule["type"]
  message: string
  nodeIds: string[]
  edgeIds: string[]
}

export interface Analysis {
  /** node ids nothing imports — likely dead code */
  orphans: string[]
  /** each entry is a dependency cycle (list of node ids) */
  cycles: string[][]
}
