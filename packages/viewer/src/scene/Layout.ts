import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force-3d"
import type { SimNode } from "d3-force-3d"
import type { GraphData, Vec3 } from "../types"

/**
 * Static 3D force layout: settle synchronously at load, then the scene is
 * calm (moodboard rule — the graph organises itself once, then holds still).
 */
export function runLayout(data: GraphData): Map<string, Vec3> {
  const nodes: SimNode[] = data.nodes.map((n) => ({ id: n.id }))
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

  sim.tick(300)
  sim.stop()

  const positions = new Map<string, Vec3>()
  for (const n of nodes) positions.set(n.id, [n.x ?? 0, n.y ?? 0, n.z ?? 0])
  return positions
}
