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
}

export type Vec3 = [number, number, number]
