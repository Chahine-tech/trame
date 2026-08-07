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

export interface LayoutOptions {
  /** positions from the previous graph — keeps the mental map stable on reload */
  previous?: Map<string, Vec3>
  /** nodes the user dragged: frozen, never moved by the simulation */
  pinned?: Set<string>
}

/**
 * Static 3D force layout: settle synchronously, then the scene is calm.
 * On a watch-mode reload the simulation restarts from the previous positions
 * and pinned nodes stay put, so a file save never rearranges work you did
 * by hand — only genuinely new nodes have to find a place.
 */
export function runLayout(data: GraphData, options: LayoutOptions = {}): Map<string, Vec3> {
  const { previous, pinned } = options
  let hadPrevious = false

  const nodes: SimNode[] = data.nodes.map((n) => {
    const node: SimNode = { id: n.id, cluster: n.cluster }
    // positions persisted in the file win, then the live previous layout
    const seed = previous?.get(n.id) ?? (n.x !== undefined ? ([n.x, n.y!, n.z!] as Vec3) : undefined)
    if (seed) {
      hadPrevious = true
      node.x = seed[0]
      node.y = seed[1]
      node.z = seed[2]
      if (pinned?.has(n.id)) {
        node.fx = seed[0]
        node.fy = seed[1]
        node.fz = seed[2]
      }
    }
    return node
  })

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

  // a warm start only needs to place the newcomers, not redraw the world
  sim.tick(hadPrevious ? 60 : 300)
  sim.stop()

  const positions = new Map<string, Vec3>()
  for (const n of nodes) positions.set(n.id, [n.x ?? 0, n.y ?? 0, n.z ?? 0])
  return positions
}
