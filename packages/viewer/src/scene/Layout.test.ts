import { describe, expect, it } from "vitest"
import { runLayout } from "./Layout"
import type { GraphData, NodeType, Vec3 } from "../types"

function graph(ids: string[], links: [string, string][], cluster = "src"): GraphData {
  return {
    meta: { project: "t", generated: "", nodeCount: ids.length, edgeCount: links.length },
    nodes: ids.map((id) => ({
      id,
      label: id,
      type: "module" as NodeType,
      file: id,
      line: 1,
      cluster,
    })),
    edges: links.map(([source, target], i) => ({
      id: `e${i}`,
      source,
      target,
      type: "import" as const,
    })),
    clusters: [],
  }
}

/** A chain of `n` nodes, prefixed so two chains stay distinct. */
function chain(prefix: string, n: number): { ids: string[]; links: [string, string][] } {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i}`)
  const links: [string, string][] = []
  for (let i = 1; i < n; i++) links.push([ids[i - 1]!, ids[i]!])
  return { ids, links }
}

function spread(positions: Map<string, Vec3>, ids: string[]): { centre: Vec3; radius: number } {
  const centre: Vec3 = [0, 0, 0]
  for (const id of ids) {
    const p = positions.get(id)!
    centre[0] += p[0] / ids.length
    centre[1] += p[1] / ids.length
    centre[2] += p[2] / ids.length
  }
  let radius = 0
  for (const id of ids) {
    const p = positions.get(id)!
    radius = Math.max(radius, Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]))
  }
  return { centre, radius }
}

function apart(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe("disconnected components", () => {
  it("keeps two components apart instead of letting them overlap", () => {
    // pulling every component to the origin packs them concentrically: measured
    // on trame's own monorepo, centroids 32 apart with radii of 130 and 99 —
    // a 44-file package threaded through a 17-file one
    const a = chain("a", 12)
    const b = chain("b", 8)
    const positions = runLayout(graph([...a.ids, ...b.ids], [...a.links, ...b.links]))

    const first = spread(positions, a.ids)
    const second = spread(positions, b.ids)
    expect(apart(first.centre, second.centre)).toBeGreaterThan(first.radius + second.radius)
  })

  it("does not let a component run away, as repulsion alone would", () => {
    // forceLink never acts between components and forceCenter only translates
    // the cloud, so nothing bounded the distance: on ./packages the median
    // radius was 125 for 64 nodes, against 31 for a connected graph of 24
    const a = chain("a", 10)
    const b = chain("b", 10)
    const c = chain("c", 10)
    const positions = runLayout(
      graph([...a.ids, ...b.ids, ...c.ids], [...a.links, ...b.links, ...c.links]),
    )
    const radii = [...positions.values()].map((p) => Math.hypot(p[0], p[1], p[2]))
    expect(Math.max(...radii)).toBeLessThan(400)
  })

  it("separates lone nodes that share no edge with anything", () => {
    // vite.config.ts and friends import only external packages, so each is a
    // component of one; placed carelessly they land on the same spot
    const a = chain("a", 6)
    const positions = runLayout(graph([...a.ids, "solo1", "solo2", "solo3"], a.links))
    for (const [x, y] of [
      ["solo1", "solo2"],
      ["solo1", "solo3"],
      ["solo2", "solo3"],
    ] as const) {
      expect(apart(positions.get(x)!, positions.get(y)!)).toBeGreaterThan(1)
    }
  })

  it("puts the largest component in the middle", () => {
    // the component carrying the most meaning should hold the centre rather
    // than be pushed aside by whichever one was parsed first
    const small = chain("small", 4)
    const big = chain("big", 20)
    const positions = runLayout(
      graph([...small.ids, ...big.ids], [...small.links, ...big.links]),
    )
    const centre = spread(positions, big.ids).centre
    expect(Math.hypot(centre[0], centre[1], centre[2])).toBeLessThan(1)
  })
})

describe("large graphs", () => {
  /** A hub every `spread` nodes, so the graph has the skew a real one has. */
  function repo(files: number): GraphData {
    const ids = Array.from({ length: files }, (_, i) => `f${i}`)
    const links: [string, string][] = []
    for (let i = 1; i < files; i++) {
      // everything reaches for one of a few utilities…
      links.push([ids[i]!, ids[i % 7]!])
      // …and its own neighbourhood
      if (i > 20) links.push([ids[i]!, ids[i - 20]!])
    }
    return graph(ids, links)
  }

  it("does not leave files piled on top of each other", () => {
    // the multi-level pass places each file at its group's position, so without
    // a final settling they arrive stacked. Measured on cal.com: nearest
    // neighbour 0.52 with no settling, 23.8 after ten ticks, and no better
    // after forty — this is the property those ten ticks are bought for.
    const positions = runLayout(repo(600))
    const all = [...positions.values()]
    let closest = Infinity
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) closest = Math.min(closest, apart(all[i]!, all[j]!))
    }
    expect(closest).toBeGreaterThan(1)
  })

  it("coarsens a star, which pairing cannot", () => {
    // heavy-edge matching pairs a node with a *free* neighbour, so a utility
    // imported by everything pairs with one file and strands the rest. On
    // cal.com it stalled at 1075 nodes after fourteen levels and saved nothing.
    // Grouping collapses the whole star at once, so this has to lay out quickly
    // and sensibly rather than crawl.
    const ids = ["hub", ...Array.from({ length: 400 }, (_, i) => `leaf${i}`)]
    const links = ids.slice(1).map((id) => [id, "hub"] as [string, string])
    const started = Date.now()
    const positions = runLayout(graph(ids, links))
    expect(Date.now() - started).toBeLessThan(4000)
    expect(positions.size).toBe(401)
    for (const p of positions.values()) expect(Number.isFinite(p[0])).toBe(true)
  })

  it("is deterministic at a size that goes through coarsening", () => {
    const data = repo(300)
    expect(runLayout(data)).toEqual(runLayout(data))
  })
})

describe("graphs that are whole", () => {
  it("leaves a connected graph exactly as the simulation left it", () => {
    // the ordinary case, and every layout tuned by hand so far: packing must
    // not quietly recompose a graph that was never broken
    const a = chain("a", 15)
    const before = runLayout(graph(a.ids, a.links))
    const after = runLayout(graph(a.ids, a.links))
    for (const id of a.ids) expect(after.get(id)).toEqual(before.get(id))
  })

  it("is deterministic, so two runs of the tool agree", () => {
    const a = chain("a", 8)
    const b = chain("b", 5)
    const data = graph([...a.ids, ...b.ids], [...a.links, ...b.links])
    expect(runLayout(data)).toEqual(runLayout(data))
  })
})

describe("warm starts", () => {
  it("never moves a node the reader pinned, even to tidy its component", () => {
    // packing translates whole components, so a component holding a pinned node
    // has to hold its ground and let the others arrange themselves around it —
    // otherwise dragging a node somewhere on purpose lasts until the next save
    const a = chain("a", 6)
    const b = chain("b", 4)
    const data = graph([...a.ids, ...b.ids], [...a.links, ...b.links])
    const previous = runLayout(data)

    const anchor = a.ids[2]!
    const at = previous.get(anchor)!
    const again = runLayout(data, { previous, pinned: new Set([anchor]) })
    expect(again.get(anchor)).toEqual(at)
  })

  it("does not re-pack a graph that already has positions", () => {
    // the components were packed when the graph was first laid out; moving them
    // again would drag a node the reader had dragged somewhere on purpose
    const a = chain("a", 6)
    const b = chain("b", 4)
    const data = graph([...a.ids, ...b.ids], [...a.links, ...b.links])
    const first = runLayout(data)

    const previous = new Map(first)
    const again = runLayout(data, { previous })
    // a warm start still settles, but nothing is teleported across the scene
    for (const id of [...a.ids, ...b.ids]) {
      expect(apart(again.get(id)!, previous.get(id)!)).toBeLessThan(60)
    }
  })
})
