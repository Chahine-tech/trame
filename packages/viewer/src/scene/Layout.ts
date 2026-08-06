import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force-3d"
import type { SimNode } from "d3-force-3d"
import type { GraphData, Vec3 } from "../types"

/**
 * Gentle pull of every node toward its folder's centroid. Folders become
 * compact, separated neighbourhoods — the grouping lives in the geometry
 * itself (Gestalt proximity), not in a drawing layered on top.
 */
function forceCluster(strength = 0.08) {
  let nodes: SimNode[] = []
  const force = (alpha: number) => {
    const centroids = new Map<string, { x: number; y: number; z: number; n: number }>()
    for (const d of nodes) {
      const key = d.cluster as string
      const c = centroids.get(key) ?? { x: 0, y: 0, z: 0, n: 0 }
      c.x += d.x ?? 0
      c.y += d.y ?? 0
      c.z += d.z ?? 0
      c.n++
      centroids.set(key, c)
    }
    const k = strength * alpha
    for (const d of nodes) {
      const c = centroids.get(d.cluster as string)
      if (!c || c.n < 2) continue
      d.vx = (d.vx ?? 0) + (c.x / c.n - (d.x ?? 0)) * k
      d.vy = (d.vy ?? 0) + (c.y / c.n - (d.y ?? 0)) * k
      d.vz = (d.vz ?? 0) + (c.z / c.n - (d.z ?? 0)) * k
    }
  }
  force.initialize = (n: SimNode[]) => {
    nodes = n
  }
  return force
}

/**
 * Static 3D force layout: settle synchronously at load, then the scene is
 * calm (moodboard rule — the graph organises itself once, then holds still).
 */
export function runLayout(data: GraphData): Map<string, Vec3> {
  const nodes: SimNode[] = data.nodes.map((n) => ({ id: n.id, cluster: n.cluster }))
  const links = data.edges.map((e) => ({ source: e.source, target: e.target }))

  const sim = forceSimulation(nodes, 3)
    .force(
      "link",
      forceLink(links)
        .id((d: SimNode) => d.id)
        .distance(14)
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-60))
    .force("center", forceCenter(0, 0, 0))
    .force("cluster", forceCluster())

  sim.tick(300)
  sim.stop()

  const positions = new Map<string, Vec3>()
  for (const n of nodes) positions.set(n.id, [n.x ?? 0, n.y ?? 0, n.z ?? 0])
  return positions
}
