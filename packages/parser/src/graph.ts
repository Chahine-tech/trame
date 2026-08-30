import path from "node:path"
import type { Project } from "ts-morph"
import type { EdgeType, GraphCluster, GraphData, GraphEdge, GraphNode, NodeType } from "./types.js"
import { classify, clusterFor, firstExportLine, labelFor, packageFor } from "./parsers/classify.js"
import { extractImports } from "./parsers/imports.js"
import { extractApiCalls } from "./parsers/api-calls.js"
import { extractQueryKeys } from "./parsers/query-keys.js"

/** Catppuccin Mocha accents, cycled across clusters. */
const CLUSTER_COLORS = [
  "#89b4fa", // blue
  "#a6e3a1", // green
  "#cba6f7", // mauve
  "#fab387", // peach
  "#94e2d5", // teal
  "#f5c2e7", // pink
  "#f9e2af", // yellow
  "#b4befe", // lavender
]

/** Edge semantics derive from what is being imported. */
function edgeTypeFor(targetType: NodeType): EdgeType {
  switch (targetType) {
    case "component":
      return "component"
    case "api":
      return "api-call"
    case "context":
      return "context"
    case "query-key":
      return "query-key"
    default:
      return "import"
  }
}

export function buildGraph(project: Project, srcRoot: string, projectName: string): GraphData {
  const files = project.getSourceFiles().filter((f) => !f.getFilePath().endsWith(".d.ts"))

  const nodes: GraphNode[] = []
  const byPath = new Map<string, GraphNode>()

  for (const file of files) {
    const abs = file.getFilePath() as string
    const rel = path.relative(srcRoot, abs)
    if (rel.startsWith("..")) continue
    const node: GraphNode = {
      id: rel,
      label: labelFor(file),
      type: classify(file),
      // relative, with the root recorded once in meta, because a graph is a thing
      // people share, and it should not carry the layout of their machine
      file: rel,
      line: firstExportLine(file),
      // the package it belongs to when there is one, the folder shape otherwise
      cluster: packageFor(abs, srcRoot) ?? clusterFor(rel),
    }
    nodes.push(node)
    byPath.set(abs, node)
  }

  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const raw of extractImports(project)) {
    const source = byPath.get(raw.from)
    const target = byPath.get(raw.to)
    if (!source || !target) continue
    const id = `${source.id}->${target.id}`
    if (seen.has(id)) continue
    seen.add(id)
    edges.push({ id, source: source.id, target: target.id, type: edgeTypeFor(target.type) })
  }

  // ---- synthetic nodes: API endpoints (fetch/axios/ky call sites) ----
  for (const usage of extractApiCalls(project)) {
    const caller = byPath.get(usage.file)
    if (!caller) continue
    const id = `api:${usage.method} ${usage.endpoint}`
    if (!byPath.has(id)) {
      const node: GraphNode = {
        id,
        label: `${usage.method} ${usage.endpoint}`,
        type: "api",
        file: path.relative(srcRoot, usage.file),
        line: usage.line,
        cluster: "api",
        meta: { endpoint: usage.endpoint, method: usage.method },
      }
      nodes.push(node)
      byPath.set(id, node)
    }
    const edgeId = `${caller.id}->${id}`
    if (!seen.has(edgeId)) {
      seen.add(edgeId)
      edges.push({ id: edgeId, source: caller.id, target: id, type: "api-call" })
    }
  }

  // ---- synthetic nodes: TanStack Query keys ----
  for (const usage of extractQueryKeys(project)) {
    const caller = byPath.get(usage.file)
    if (!caller) continue
    const id = `qk:${usage.queryKey}`
    if (!byPath.has(id)) {
      const label = usage.queryKey.length > 30 ? `${usage.queryKey.slice(0, 27)}…` : usage.queryKey
      const node: GraphNode = {
        id,
        label,
        type: "query-key",
        file: path.relative(srcRoot, usage.file),
        line: usage.line,
        cluster: "queries",
        meta: { queryKey: usage.queryKey },
      }
      nodes.push(node)
      byPath.set(id, node)
    }
    const edgeId = `${caller.id}->${id}`
    if (!seen.has(edgeId)) {
      seen.add(edgeId)
      edges.push({ id: edgeId, source: caller.id, target: id, type: "query-key" })
    }
  }

  const clusterMap = new Map<string, string[]>()
  for (const node of nodes) {
    const list = clusterMap.get(node.cluster) ?? []
    list.push(node.id)
    clusterMap.set(node.cluster, list)
  }
  const clusters: GraphCluster[] = [...clusterMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, nodeIds], i) => ({
      id,
      label: id,
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length]!,
      nodeIds,
    }))

  return {
    meta: {
      project: projectName,
      generated: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      root: srcRoot,
    },
    nodes,
    edges,
    clusters,
  }
}
