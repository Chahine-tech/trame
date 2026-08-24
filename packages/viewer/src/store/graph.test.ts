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

/**
 * Big enough that the skeleton actually withholds something — below the render
 * budget it returns null and a selection narrows nothing, so the bug this
 * describes cannot even happen on a small graph.
 *
 * A ring of 300 (everything at coreness 2) with 200 leaves hanging off it
 * (coreness 1): k=1 overflows the budget, k=2 fits, so the skeleton is the
 * ring. Degrees stay well under the threshold that would mark a file as
 * traffic and take it out of the structure.
 */
function ringWithLeaves(): GraphData {
  const ring = Array.from({ length: 300 }, (_, i) => `ring/${i}.ts`)
  const leaves = Array.from({ length: 200 }, (_, i) => `leaf/${i}.ts`)
  const files = [...ring, ...leaves]
  const g = graph("big", files, "2026-01-01T00:00:00Z")
  g.edges = [
    ...ring.map((id, i) => ({
      id: `r${i}`,
      source: id,
      target: ring[(i + 1) % ring.length]!,
      type: "import" as const,
    })),
    ...leaves.map((id, i) => ({
      id: `l${i}`,
      source: id,
      target: ring[i]!,
      type: "import" as const,
    })),
  ]
  g.meta.edgeCount = g.edges.length
  return g
}

describe("letting go of a selection", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
  })

  it("narrows to a neighbourhood on the way in", () => {
    const before = useGraphStore.getState()
    expect(before.skeletonSet?.size).toBe(300)

    useGraphStore.getState().select("ring/0.ts")
    const after = useGraphStore.getState()
    expect(after.nearby!.size).toBeLessThan(before.skeletonSet!.size)
  })

  it("gives the map back on the way out", () => {
    /**
     * Both ways out ran through `clear`, which dropped the selection and left
     * `nearby` where the selection had put it. The result was a neighbourhood
     * of nothing — sixty-five files of three and a half thousand, unlit — and
     * nothing widened it again, so a reload was the only way back to the map.
     */
    const { skeletonSet } = useGraphStore.getState()
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().clear()

    const s = useGraphStore.getState()
    expect(s.selectedId).toBeNull()
    expect(s.nearby).toBe(skeletonSet)
    expect(s.nearby!.size).toBe(300)
  })

  it("flies the camera back out instead of leaving it on the knot", () => {
    useGraphStore.getState().select("ring/0.ts")
    const close = useGraphStore.getState().extent
    useGraphStore.getState().clear()
    const s = useGraphStore.getState()
    expect(s.extent).toBeGreaterThan(close)
    // a target rather than a jump — the rig eases toward it and releases
    expect(s.focusTarget).not.toBeNull()
  })

  it("leaves the camera alone when there was nothing to let go of", () => {
    /**
     * Clicking the background is also how people find out that nothing was
     * selected; taking the view off them for it would punish the gesture.
     *
     * The first `clear` is not ceremony. Loading opens on a finding, which
     * selects a file — so the map is narrowed before anyone has clicked
     * anything, and this is the state a second click has to leave alone.
     */
    useGraphStore.getState().clear()
    const before = useGraphStore.getState().extent
    useGraphStore.getState().clear()
    const s = useGraphStore.getState()
    expect(s.extent).toBe(before)
    expect(s.focusTarget).toBeNull()
  })

  it("re-qualifies the names for the population now on screen", () => {
    // two files can share a basename without sharing a screen; the qualifiers
    // described who the neighbourhood held, and that is no longer the question
    useGraphStore.getState().select("ring/0.ts")
    const narrowed = useGraphStore.getState().names.size
    useGraphStore.getState().clear()
    expect(useGraphStore.getState().names.size).toBeGreaterThan(narrowed)
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
