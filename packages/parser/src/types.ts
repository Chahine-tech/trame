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

export interface GraphNode {
  id: string
  label: string
  type: NodeType
  file: string
  line: number
  cluster: string
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
  }
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
  violations?: Violation[]
}

/* ---------- constraint rules (archviz.config.ts) ---------- */

export interface RuleMatch {
  edgeType?: EdgeType
  sourceType?: NodeType
  targetType?: NodeType
}

export interface Rule {
  /** unique-caller: a matched target may have only one matching caller.
   *  no-direct-import: any matching edge is a violation. */
  type: "unique-caller" | "no-direct-import"
  match: RuleMatch
  message: string
}

export interface ArchvizConfig {
  rules?: Rule[]
}

export interface Violation {
  rule: Rule["type"]
  message: string
  nodeIds: string[]
  edgeIds: string[]
}
