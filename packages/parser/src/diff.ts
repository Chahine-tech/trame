import type { GraphData, GraphEdge, GraphNode } from "./types.js"

/**
 * Merge two graphs into one the viewer can render: everything from head,
 * plus the nodes and edges that head dropped, each tagged with its status.
 * Removed items keep their base positions so they render as ghosts.
 */
export function diffGraphs(base: GraphData, head: GraphData): GraphData {
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]))
  const headNodes = new Map(head.nodes.map((n) => [n.id, n]))
  const baseEdges = new Map(base.edges.map((e) => [e.id, e]))
  const headEdges = new Map(head.edges.map((e) => [e.id, e]))

  const nodes: GraphNode[] = head.nodes.map((n) => ({
    ...n,
    diff: baseNodes.has(n.id) ? "same" : "added",
  }))
  for (const n of base.nodes) {
    if (!headNodes.has(n.id)) nodes.push({ ...n, diff: "removed" })
  }

  const edges: GraphEdge[] = head.edges.map((e) => ({
    ...e,
    diff: baseEdges.has(e.id) ? "same" : "added",
  }))
  for (const e of base.edges) {
    if (!headEdges.has(e.id)) edges.push({ ...e, diff: "removed" })
  }

  // clusters must cover every node, ghosts included, or layout drops them
  const clusterMap = new Map<string, string[]>()
  for (const n of nodes) {
    const list = clusterMap.get(n.cluster) ?? []
    list.push(n.id)
    clusterMap.set(n.cluster, list)
  }
  const colorOf = new Map([...head.clusters, ...base.clusters].map((c) => [c.id, c.color]))
  const clusters = [...clusterMap.entries()].map(([id, nodeIds]) => ({
    id,
    label: id,
    color: colorOf.get(id) ?? "#6c7086",
    nodeIds,
  }))

  const added = nodes.filter((n) => n.diff === "added").length
  const removed = nodes.filter((n) => n.diff === "removed").length

  return {
    ...head,
    meta: {
      ...head.meta,
      project: `${head.meta.project} (diff)`,
      generated: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
    nodes,
    edges,
    clusters,
    diff: {
      addedNodes: added,
      removedNodes: removed,
      addedEdges: edges.filter((e) => e.diff === "added").length,
      removedEdges: edges.filter((e) => e.diff === "removed").length,
    },
  }
}
