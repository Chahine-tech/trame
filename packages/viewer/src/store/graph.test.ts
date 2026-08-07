import { beforeEach, describe, expect, it, vi } from "vitest"
import { useGraphStore } from "./graph"
import type { GraphData, Timeline } from "../types"

// the store reaches for toasts and the DOM palette; neither is the subject here
vi.mock("../ui/toast", () => ({
  toastNeedsSelection: vi.fn(),
  toastNoPath: vi.fn(),
}))

function graph(id: string, files: string[], generated: string): GraphData {
  return {
    meta: { project: "t", generated, nodeCount: files.length, edgeCount: 0 },
    nodes: files.map((f) => ({
      id: f,
      label: f,
      type: "module" as const,
      file: `/${f}`,
      line: 1,
      cluster: id,
    })),
    edges: [],
    clusters: [{ id, label: id, color: "#fff", nodeIds: files }],
  }
}

const timeline: Timeline = {
  meta: { project: "t", generated: "now", frameCount: 2, from: "a", to: "b" },
  frames: [
    {
      sha: "aaa",
      date: "2026-01-01",
      subject: "first",
      author: "x",
      nodeCount: 1,
      edgeCount: 0,
      added: [],
      removed: [],
      violations: 0,
      cycles: 0,
      graph: graph("past", ["a.ts"], "2026-01-01T00:00:00Z"),
    },
    {
      sha: "bbb",
      date: "2026-01-02",
      subject: "second",
      author: "x",
      nodeCount: 2,
      edgeCount: 0,
      added: ["b.ts"],
      removed: [],
      violations: 0,
      cycles: 0,
      graph: graph("past", ["a.ts", "b.ts"], "2026-01-02T00:00:00Z"),
    },
  ],
}

const live = graph("now", ["a.ts", "b.ts", "c.ts"], "2026-06-01T00:00:00Z")

describe("replay lens", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(live)
  })

  it("stays on the present until the replay is entered", () => {
    useGraphStore.getState().loadTimeline(timeline)
    const s = useGraphStore.getState()
    expect(s.lens).toBe("none")
    expect(s.data?.meta.generated).toBe(live.meta.generated)
  })

  it("opens at the first frame and keeps the lens on", () => {
    useGraphStore.getState().loadTimeline(timeline)
    useGraphStore.getState().enterReplay()
    const s = useGraphStore.getState()
    // load() resets every lens, so showFrame has to reassert it afterwards
    expect(s.lens).toBe("replay")
    expect(s.frameIndex).toBe(0)
    expect(s.data?.nodes).toHaveLength(1)
  })

  it("marks what a frame introduced", () => {
    useGraphStore.getState().loadTimeline(timeline)
    useGraphStore.getState().enterReplay()
    useGraphStore.getState().showFrame(1)
    const s = useGraphStore.getState()
    expect(s.frameAdded.has("b.ts")).toBe(true)
    expect(s.data?.nodes).toHaveLength(2)
  })

  it("restores the present on exit — the newest one, not the one from entry", () => {
    useGraphStore.getState().loadTimeline(timeline)
    useGraphStore.getState().enterReplay()
    // the watch poll fires while history is on screen
    const newer = graph("now", ["a.ts", "b.ts", "c.ts", "d.ts"], "2026-06-02T00:00:00Z")
    useGraphStore.setState({ present: newer })

    useGraphStore.getState().exitReplay()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("none")
    expect(s.data?.nodes).toHaveLength(4)
    expect(s.frameAdded.size).toBe(0)
  })
})

describe("lenses are mutually exclusive", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(live)
  })

  it("entering the replay drops any other lens", () => {
    useGraphStore.getState().select("a.ts")
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().lens).toBe("impact")

    useGraphStore.getState().loadTimeline(timeline)
    useGraphStore.getState().enterReplay()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("replay")
    expect(s.impactOf).toBeNull()
  })
})
