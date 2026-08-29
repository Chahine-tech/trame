import { describe, expect, it } from "vitest"
import { replayOf } from "./timeline"
import type { GraphData, GraphNode, NodeType, ReplayFrame, Timeline } from "../types"

function node(id: string, type: NodeType = "module", line = 1): GraphNode {
  return { id, label: id, type, file: id, line, cluster: "src" }
}

function graph(nodes: GraphNode[], links: [string, string][] = []): GraphData {
  return {
    meta: { project: "t", generated: "", nodeCount: nodes.length, edgeCount: links.length },
    nodes,
    edges: links.map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
      type: "import" as const,
    })),
    clusters: [],
  }
}

function frame(over: Partial<ReplayFrame>): ReplayFrame {
  return {
    sha: "0000000",
    date: "",
    subject: "",
    author: "",
    nodeCount: 0,
    edgeCount: 0,
    added: [],
    removed: [],
    violations: 0,
    cycles: 0,
    ...over,
  }
}

function timeline(frames: ReplayFrame[]): Timeline {
  return {
    meta: { project: "t", generated: "", frameCount: frames.length, from: "", to: "" },
    frames,
  }
}

const empty = {
  addedNodes: [],
  changedNodes: [],
  removedNodes: [],
  addedEdges: [],
  changedEdges: [],
  removedEdges: [],
}

describe("rebuilding a frame", () => {
  const grown = timeline([
    frame({ graph: graph([node("a"), node("b")], [["a", "b"]]) }),
    frame({
      delta: { ...empty, addedNodes: [node("c")], addedEdges: graph([], [["b", "c"]]).edges },
    }),
    frame({ delta: { ...empty, removedNodes: ["a"], removedEdges: ["a->b"] } }),
  ])

  it("gives the first frame back as it was written", () => {
    expect(
      replayOf(grown)
        .at(0)!
        .nodes.map((n) => n.id),
    ).toEqual(["a", "b"])
  })

  it("applies what a commit added", () => {
    const at = replayOf(grown).at(1)!
    expect(at.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"])
    expect(at.edges.map((e) => e.id).sort()).toEqual(["a->b", "b->c"])
  })

  it("applies what a commit took away", () => {
    const at = replayOf(grown).at(2)!
    expect(at.nodes.map((n) => n.id).sort()).toEqual(["b", "c"])
    expect(at.edges.map((e) => e.id)).toEqual(["b->c"])
  })

  it("carries a file that changed without arriving or leaving", () => {
    // a module that becomes a component is drawn differently: the type decides
    // shape and colour, so a delta that only tracked arrivals would lose it
    const changed = timeline([
      frame({ graph: graph([node("a")]) }),
      frame({ delta: { ...empty, changedNodes: [node("a", "component", 42)] } }),
    ])
    const at = replayOf(changed).at(1)!
    expect(at.nodes[0]!.type).toBe("component")
    expect(at.nodes[0]!.line).toBe(42)
  })

  it("keeps the counts honest as the graph moves", () => {
    const at = replayOf(grown).at(2)!
    expect(at.meta.nodeCount).toBe(2)
    expect(at.meta.edgeCount).toBe(1)
  })
})

describe("scrubbing", () => {
  const many = timeline([
    frame({ graph: graph([node("f0")]) }),
    ...Array.from({ length: 20 }, (_, i) =>
      frame({ delta: { ...empty, addedNodes: [node(`f${i + 1}`)] } }),
    ),
  ])

  it("reaches the same frame whichever way it is approached", () => {
    // forwards, then back: the walk keeps a cursor and rewinds when it has to,
    // and a rewind that lost track would show a graph from another commit
    const replay = replayOf(many)
    const forwards = replay.at(15)!.nodes.length
    replay.at(20)
    replay.at(3)
    expect(replay.at(15)!.nodes.length).toBe(forwards)
  })

  it("grows one file per commit, all the way along", () => {
    const replay = replayOf(many)
    for (const i of [0, 7, 20, 1, 19]) expect(replay.at(i)!.nodes.length).toBe(i + 1)
  })

  it("has nothing to show past the end", () => {
    expect(replayOf(many).at(99)).toBeNull()
  })
})

describe("replays written before the format changed", () => {
  it("still reads, frame by frame", () => {
    // every frame used to carry the whole graph; those files are already on
    // disk and in people's repositories
    const old = timeline([
      frame({ graph: graph([node("a")]) }),
      frame({ graph: graph([node("a"), node("b")]) }),
    ])
    expect(
      replayOf(old)
        .at(1)!
        .nodes.map((n) => n.id),
    ).toEqual(["a", "b"])
  })

  it("says nothing at all when the first frame is missing its graph", () => {
    expect(replayOf(timeline([frame({})])).at(0)).toBeNull()
  })
})
