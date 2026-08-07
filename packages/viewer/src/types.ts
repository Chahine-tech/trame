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
  diff?: {
    addedNodes: number
    removedNodes: number
    addedEdges: number
    removedEdges: number
  }
}

export type Vec3 = [number, number, number]

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
  graph: GraphData
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
