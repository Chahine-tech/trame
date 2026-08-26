import { beforeEach, describe, expect, it, vi } from "vitest"
import { useGraphStore } from "./graph"
import type { GraphData, Timeline } from "../types"

// the store reaches for toasts and the DOM palette; neither is the subject here
vi.mock("../ui/toast", () => ({
  toastNeedsSelection: vi.fn(),
  toastNoPath: vi.fn(),
  toastDeselected: vi.fn(),
  UNDO_MS: 5000,
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

  it("restores the present on exit: the newest one, not the one from entry", () => {
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
 * Big enough that the skeleton actually withholds something: below the render
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
     * of nothing: sixty-five files of three and a half thousand, unlit, and
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
    // a target rather than a jump: the rig eases toward it and releases
    expect(s.focusTarget).not.toBeNull()
  })

  it("leaves the camera alone when there was nothing to let go of", () => {
    /**
     * Clicking the background is also how people find out that nothing was
     * selected; taking the view off them for it would punish the gesture.
     *
     * The first `clear` is not ceremony. Loading opens on a finding, which
     * selects a file, so the map is narrowed before anyone has clicked
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

describe("a lens widens the view to the question it asks", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
  })

  it("draws the propagation, not the neighbourhood it started from", () => {
    /**
     * The detail view reaches two hops. On dub's `tinybird` that put 57 of the
     * 59 visible files at the same depth, so the ring-by-ring reveal had
     * nothing to reveal and the bar read "948 dependents" over a picture of
     * the first circle.
     */
    useGraphStore.getState().select("ring/0.ts")
    const near = useGraphStore.getState().nearby!.size
    useGraphStore.getState().toggleImpact()
    const wide = useGraphStore.getState().nearby!.size
    expect(wide).toBeGreaterThan(near)
    expect(useGraphStore.getState().lens).toBe("impact")
  })

  it("draws only what the lens actually found", () => {
    // every file it shows is in the impact set, or the picture claims more
    // than the count does
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleImpact()
    const { nearby, impactDepth } = useGraphStore.getState()
    for (const id of nearby!) expect(impactDepth.has(id)).toBe(true)
  })

  it("hands the map back when the lens closes", () => {
    useGraphStore.getState().select("ring/0.ts")
    const before = useGraphStore.getState().nearby!.size
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().toggleImpact()
    const after = useGraphStore.getState()
    expect(after.nearby!.size).toBe(before)
    expect(after.lens).toBe("none")
  })

  it("hands it back through escape as well as through the key", () => {
    // esc walks back one layer: it drops the lens without dropping the file
    useGraphStore.getState().select("ring/0.ts")
    const before = useGraphStore.getState().nearby!.size
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().clearLens()
    const after = useGraphStore.getState()
    expect(after.nearby!.size).toBe(before)
    expect(after.selectedId).toBe("ring/0.ts")
  })
})

describe("toggling a lens does not walk the camera", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
  })

  it("comes back to the same framing however many times it is pressed", () => {
    /**
     * Two mechanisms move the camera. `Scene`'s opening shot frames around the
     * origin and looks at it; `CameraRig` frames around whatever is being read,
     * which for a neighbourhood is a knot off to one side. They only ever met
     * on a load, where one was a no-op.
     *
     * A lens changing the extent made them meet on every press, and each toggle
     * started from where the other had left off, so the graph walked out of
     * frame. The store's half of the contract is this: the view a lens hands
     * back is the view it was given, exactly, every time.
     */
    useGraphStore.getState().select("ring/0.ts")
    const { extent, focusTarget, nearby } = useGraphStore.getState()

    for (let i = 0; i < 5; i++) {
      useGraphStore.getState().toggleImpact()
      useGraphStore.getState().toggleImpact()
    }

    const after = useGraphStore.getState()
    expect(after.extent).toBe(extent)
    expect(after.focusTarget).toEqual(focusTarget)
    expect(after.nearby!.size).toBe(nearby!.size)
  })

  it("frames the propagation the same way on every press", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleImpact()
    const first = useGraphStore.getState().extent
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().extent).toBe(first)
  })
})

describe("a lens never costs the reader their selection", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
  })

  it("keeps the file in hand through any number of toggles", () => {
    /**
     * Spamming `I` lost the selection, and the path was long enough to be worth
     * writing down. The lens moves `extent`; the rig takes half a second to fly
     * the camera to match; `ZoomDirector` compares the two every frame and
     * reads the gap as "the reader has zoomed out to the district level";
     * entering that level clears the selection, on purpose, because it is the
     * file level you are leaving.
     *
     * Three correct behaviours, one wrong outcome. This is the end of the chain
     * and the only part of it a store test can hold.
     */
    useGraphStore.getState().select("ring/0.ts")
    for (let i = 0; i < 12; i++) useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().selectedId).toBe("ring/0.ts")
  })

  it("still drops it when the reader actually leaves the file level", () => {
    // the guard above must not turn into "district mode keeps the selection"
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().setDistrictMode(true)
    expect(useGraphStore.getState().selectedId).toBeNull()
  })
})

describe("the camera knows where it is looking, not only how far", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
  })

  it("keeps the middle of what is drawn for as long as it is drawn", () => {
    /**
     * `reachOf` returns a centre and a size. Every caller used to keep the size
     * in `extent` and hand the centre to `focusTarget`, which the rig deletes
     * on arrival. Five frames after any move the scene knew how big the subject
     * was and had forgotten where, so each consumer guessed, mostly by assuming
     * the origin. A neighbourhood sits off to one side, and the disagreement
     * was exactly how far off to the side the reader had gone.
     */
    useGraphStore.getState().select("ring/0.ts")
    const { viewCentre, focusTarget } = useGraphStore.getState()
    expect(focusTarget).toEqual(viewCentre)

    // the rig lands and releases its request; the centre outlives it
    useGraphStore.getState().clearFocus()
    expect(useGraphStore.getState().viewCentre).toEqual(viewCentre)
    expect(useGraphStore.getState().focusTarget).toBeNull()
  })

  it("moves the centre with the subject, through a lens and back", () => {
    useGraphStore.getState().select("ring/0.ts")
    const near = useGraphStore.getState().viewCentre
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().viewCentre).not.toEqual(near)
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().viewCentre).toEqual(near)
  })

  it("frames the arrangement on load rather than the origin", () => {
    // the opening shot used to snap around the origin and look at it, which is
    // the same point only on a graph that happens to be centred
    const { focusTarget, viewCentre } = useGraphStore.getState()
    expect(focusTarget).not.toBeNull()
    expect(focusTarget).toEqual(viewCentre)
  })

  it("resets to the middle of the view, not to the origin", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().clearFocus()
    useGraphStore.getState().resetCamera()
    expect(useGraphStore.getState().focusTarget).toEqual(useGraphStore.getState().viewCentre)
  })
})

/**
 * A flight only ever changes the camera's distance — the rig rebuilds its
 * direction from the centre it is flying to, so it keeps the angle it already
 * had. That is right on the way out and wrong on the way back: the lens aimed
 * at its own centre and left the camera on a different side of the selection.
 * The view returned rotated, and each round trip rotated it further.
 */
describe("a lens gives the view back from where it took it", () => {
  const AT: [number, number, number] = [7, 8, 9]
  const DIR: [number, number, number] = [0, 0, 1]

  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
    useGraphStore.getState().clearFocus()
  })

  /** the rig publishes both halves when a flight settles; stand in for it */
  const settleAt = (at: [number, number, number], dir: [number, number, number]) => {
    useGraphStore.getState().setVantage(at, dir)
    useGraphStore.getState().clearFocus()
  }

  it("remembers where the reader was standing when the lens takes the camera", () => {
    useGraphStore.getState().select("ring/0.ts")
    settleAt(AT, DIR)

    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().savedVantage).toEqual({ at: AT, dir: DIR })
  })

  it("hands back the spot and the side together when the lens closes", () => {
    useGraphStore.getState().select("ring/0.ts")
    settleAt(AT, DIR)

    useGraphStore.getState().toggleImpact()
    // the outward leg parks the camera somewhere else entirely
    settleAt([100, 100, 100], [1, 0, 0])

    useGraphStore.getState().toggleImpact()
    const s = useGraphStore.getState()
    expect(s.focusTarget).toEqual(AT)
    expect(s.focusDir).toEqual(DIR)
    // and it is spent: nothing is owed a second return
    expect(s.savedVantage).toBeNull()
  })

  /**
   * The bug this pair exists for. Following a link, or pressing `F`, aims the
   * camera at one file: `focus()` sets `focusTarget` and leaves `viewCentre` on
   * the middle of what is drawn. Restoring only the angle put the camera back
   * on the recomputed centre — fifty units away on dub's tinybird, once, on the
   * first round trip, which read as the view drifting.
   */
  it("comes back to the file when the reader was looking at a file, not at the middle", () => {
    useGraphStore.getState().select("ring/0.ts")
    const centre = useGraphStore.getState().viewCentre
    useGraphStore.getState().focus("ring/0.ts")
    const onTheFile = useGraphStore.getState().focusTarget!
    expect(onTheFile).not.toEqual(centre)

    settleAt(onTheFile, DIR)
    useGraphStore.getState().toggleImpact()
    settleAt([100, 100, 100], [1, 0, 0])
    useGraphStore.getState().toggleImpact()

    expect(useGraphStore.getState().focusTarget).toEqual(onTheFile)
    // the middle of what is drawn is still the middle of what is drawn: it is
    // where `resetCamera` goes, and it was never the thing that moved
    expect(useGraphStore.getState().viewCentre).toEqual(centre)
  })

  it("keeps the angle the reader is holding when it goes somewhere new", () => {
    // only a lens closing behind itself asks for a particular side; a fresh
    // framing that swung the camera would take the reader's bearing away
    useGraphStore.getState().select("ring/0.ts")
    expect(useGraphStore.getState().focusDir).toBeNull()

    settleAt(AT, DIR)
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().select("ring/40.ts")
    expect(useGraphStore.getState().savedVantage).toBeNull()
    expect(useGraphStore.getState().focusDir).toBeNull()
  })

  it("spends the request with the flight that honoured it", () => {
    useGraphStore.getState().select("ring/0.ts")
    settleAt(AT, DIR)
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().clearFocus()
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().focusDir).not.toBeNull()

    // left standing it would drag the next flight — one going somewhere new
    useGraphStore.getState().clearFocus()
    expect(useGraphStore.getState().focusDir).toBeNull()
  })

  it("owes nothing to a lens once the map is back", () => {
    useGraphStore.getState().select("ring/0.ts")
    settleAt(AT, DIR)
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().clear()
    expect(useGraphStore.getState().savedVantage).toBeNull()
    expect(useGraphStore.getState().focusDir).toBeNull()
  })
})

/**
 * Letting go of a file is one click on a target covering most of the screen,
 * and it drops the selection, the framing and the open lens at once. The only
 * way back was to remember the filename and type it again.
 */
describe("a deselection can be taken back", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
    useGraphStore.getState().clearFocus()
    // the viewer mounts a toaster; the landing, which drives the same store,
    // does not — and the offer only exists where a notice can carry it
    useGraphStore.getState().setToastsMounted(true)
  })

  it("offers nothing where no notice can be drawn", () => {
    /**
     * The landing renders the viewer's meshes and drives this store, mounts no
     * toaster, and its last section calls `clear()`. Offering there fetched
     * goey-toast and framer-motion for a message nobody could see.
     */
    useGraphStore.getState().setToastsMounted(false)
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().clear()
    expect(useGraphStore.getState().selectedId).toBeNull()
    expect(useGraphStore.getState().cleared).toBeNull()
  })

  it("remembers what the click let go of", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().clear()

    const offer = useGraphStore.getState().cleared
    expect(offer?.selectedId).toBe("ring/0.ts")
    expect(offer?.lens).toBe("impact")
    // and the click did what it was asked: the map is back
    expect(useGraphStore.getState().selectedId).toBeNull()
    expect(useGraphStore.getState().lens).toBe("none")
  })

  it("gives back the file, the lens and where the reader stood", () => {
    const AT: [number, number, number] = [7, 8, 9]
    const DIR: [number, number, number] = [0, 0, 1]
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleImpact()
    useGraphStore.getState().setVantage(AT, DIR)
    useGraphStore.getState().clearFocus()

    useGraphStore.getState().clear()
    useGraphStore.getState().restoreCleared()

    const s = useGraphStore.getState()
    expect(s.selectedId).toBe("ring/0.ts")
    expect(s.lens).toBe("impact")
    // the standing spot outranks the framing that select and the lens each set
    expect(s.focusTarget).toEqual(AT)
    expect(s.focusDir).toEqual(DIR)
    // spent: the notice is gone, so the gesture is gone with it
    expect(s.cleared).toBeNull()
  })

  it("offers nothing when there was nothing to let go of", () => {
    // clicking the background is also how people find out nothing was
    // selected, and that click has nothing to take back. The first clear is
    // not ceremony: loading opens on a finding, so a file is already selected
    // before anyone has clicked anything
    useGraphStore.getState().clear()
    useGraphStore.getState().clear()
    expect(useGraphStore.getState().cleared).toBeNull()
    useGraphStore.getState().restoreCleared()
    expect(useGraphStore.getState().selectedId).toBeNull()
  })

  it("spends the offer when the reader moves on", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().clear()
    expect(useGraphStore.getState().cleared).not.toBeNull()

    useGraphStore.getState().select("ring/40.ts")
    expect(useGraphStore.getState().cleared).toBeNull()
    // and the undo cannot drag them back to what they left
    useGraphStore.getState().restoreCleared()
    expect(useGraphStore.getState().selectedId).toBe("ring/40.ts")
  })
})

/**
 * R3F decides a click "missed" on the `click` event, with a fresh raycast, one
 * event after `NodeMesh` has committed the selection on `pointerup`. When that
 * second raycast comes back empty, the click that selected a file is also the
 * click that lets it go, and the reader sees their click do nothing.
 */
describe("one gesture cannot both select and deselect", () => {
  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(ringWithLeaves())
    useGraphStore.getState().clearFocus()
  })

  it("ignores a miss that belongs to the gesture that just selected", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().clearFromBackground()
    expect(useGraphStore.getState().selectedId).toBe("ring/0.ts")
    // and nothing was let go of, so nothing is offered back
    expect(useGraphStore.getState().cleared).toBeNull()
  })

  it("lets a real click on the background through", () => {
    useGraphStore.getState().select("ring/0.ts")
    // the reader looked, then clicked away: a separate gesture
    useGraphStore.setState({ selectedAt: performance.now() - 1000 })
    useGraphStore.getState().clearFromBackground()
    expect(useGraphStore.getState().selectedId).toBeNull()
    expect(useGraphStore.getState().cleared?.selectedId).toBe("ring/0.ts")
  })

  it("leaves esc alone: dropping what you just chose is a thing you can mean", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().clear()
    expect(useGraphStore.getState().selectedId).toBeNull()
  })
})
