import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { positionOf, useGraphStore } from "./graph"
import type { GraphData, Timeline, Vec3 } from "../types"

// the store reaches for toasts and the DOM palette; neither is the subject here
vi.mock("../ui/toast", () => ({
  toastNeedsSelection: vi.fn(),
  toastNoPath: vi.fn(),
  toastDeselected: vi.fn(),
  toastNoCoChange: vi.fn(),
  toastNoCoChangeFor: vi.fn(),
  toastNoHotspots: vi.fn(),
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

/**
 * The import graph draws what the code says; co-change draws what the history
 * says. A pair only survives the parser when no import connects it, so the
 * partners are almost never in the neighbourhood already.
 */
/**
 * How far a file sits from the middle of the view, as the screen sees it.
 *
 * Not its distance from the centre: what a camera has to fit is the part of a
 * set that lies *across* the view, and depth pushes a file nearer or further,
 * never off the edge. `reachOf` measures it this way whenever the reader has a
 * vantage, so a test that checks the framing has to measure it the same way or
 * it is asking the camera to cover a distance nobody can see.
 *
 * This is what made the co-change framing tests machine-dependent: they used
 * the plain radius, which is the same number only when the answer happens to
 * lie square to the camera. It did here and did not on the CI runner, so the
 * pair failed there and passed on every developer machine — by exactly the
 * projection factor, 0.83 in both.
 */
function seenFrom(at: Vec3, p: Vec3, dir?: Vec3): number {
  const d: Vec3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]]
  if (!dir) return Math.hypot(d[0], d[1], d[2])
  const len = Math.hypot(dir[0], dir[1], dir[2])
  const axis: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len]
  const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
  return Math.hypot(d[0] - t * axis[0], d[1] - t * axis[1], d[2] - t * axis[2])
}

describe("the co-change lens", () => {
  /**
   * The store is a module singleton and `load` does not clear the vantage, so
   * two tests four hundred lines up left one behind and every lens down here
   * framed across a view nobody in this block had set. That is what made these
   * tests depend on the machine: with a vantage, `reachOf` measures the reach
   * perpendicular to it, and whether that is close to the plain radius depends
   * entirely on how the simulation happened to lay the three files out.
   */
  beforeEach(() => useGraphStore.setState({ vantage: null }))

  const withHistory = () => {
    const g = ringWithLeaves()
    g.coChange = [
      { a: "ring/0.ts", b: "leaf/150.ts", together: 9, jaccard: 0.8 },
      { a: "leaf/151.ts", b: "ring/0.ts", together: 6, jaccard: 0.5 },
      { a: "ring/40.ts", b: "leaf/9.ts", together: 7, jaccard: 0.6 },
    ]
    return g
  }

  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(withHistory())
    useGraphStore.getState().setToastsMounted(true)
  })

  it("answers about the selection, from either side of the pair", () => {
    // the parser writes each pair once, in whatever order sorted them
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleCoChange()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("cochange")
    expect(s.coChangeOf).toBe("ring/0.ts")
    expect([...s.coChangeWith.keys()].sort()).toEqual(["leaf/150.ts", "leaf/151.ts"])
    expect(s.coChangeWith.get("leaf/150.ts")).toBe(0.8)
  })

  it("widens the view to the partners, which is the whole point", () => {
    /**
     * A partner is by construction not reachable by imports, so it is not in
     * the neighbourhood. Without widening, the lens would light nothing and
     * read as broken.
     */
    useGraphStore.getState().select("ring/0.ts")
    const near = useGraphStore.getState().nearby!
    expect(near.has("leaf/150.ts")).toBe(false)

    useGraphStore.getState().toggleCoChange()
    const shown = useGraphStore.getState().nearby!
    expect(shown.has("leaf/150.ts")).toBe(true)
    expect(shown.has("leaf/151.ts")).toBe(true)
    expect(shown.has("ring/0.ts")).toBe(true)
  })

  it("frames the answer, not the neighbourhood it was asked from", () => {
    /**
     * Excluding imported pairs does not make a partner distant in the graph: on
     * dub's webhook route all five sat inside the 132-file neighbourhood, two
     * hops away through a hub. Framing the union framed the neighbourhood, and
     * two of the five answers were drawn outside the picture.
     */
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleCoChange()
    const s = useGraphStore.getState()

    // the context is still drawn, so the answer keeps something to sit in
    expect(s.nearby!.size).toBeGreaterThan(s.coChangeWith.size + 1)

    // and the camera sits on the mean of the answer, not of everything drawn.
    // Which of the two is wider depends on the graph: on dub the answer was
    // tighter, here the partners hang off the far side of a 300-node ring
    const answer = ["ring/0.ts", ...s.coChangeWith.keys()]
    const mean = [0, 1, 2].map(
      (axis) => answer.reduce((t, id) => t + s.positions.get(id)![axis]!, 0) / answer.length,
    )
    for (const axis of [0, 1, 2]) expect(s.viewCentre[axis]).toBeCloseTo(mean[axis]!, 6)
    expect(s.focusTarget).toEqual(s.viewCentre)
  })

  it("puts every partner inside the frustum, not merely inside the extent", () => {
    /**
     * `extent` is a size and the rig parks at 1.35 times it, which through a
     * 60° vertical field of view shows only 0.78 of it. Everywhere else
     * `reachOf` clamps at 2.5 medians and the clamp binds, so `extent` sits
     * well under the real reach. On six files it never binds: on dub's webhook
     * route the radii were 38 128 128 162 192 220 and the two outermost were
     * drawn off the top and bottom of the screen.
     */
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleCoChange()
    const s = useGraphStore.getState()
    const at = s.viewCentre
    const halfHeight = s.extent * 1.35 * Math.tan((30 * Math.PI) / 180)
    const ids = ["ring/0.ts", ...s.coChangeWith.keys()]
    /**
     * The failure carries its own evidence.
     *
     * This went red in CI and green on two developer machines, and reasoning
     * about it from the numbers alone produced one wrong fix already: with the
     * three files this fixture pairs, the 2.5-median clamp cannot bind — two
     * points together and one away give radii of d/3, d/3 and 2d/3, whose
     * median times 2.5 is always the larger. So something here is not what it
     * is assumed to be, and the assertion says what it saw rather than leaving
     * the next reader to guess again.
     */
    for (const id of ids) {
      const r = seenFrom(at, s.positions.get(id)!, s.vantage?.dir)
      expect(r).toBeLessThan(halfHeight)
    }
  })

  it("frames a scattered answer from wherever the reader is standing", () => {
    /**
     * The version above rides on whatever the force simulation produced, and
     * that is not the same arrangement on every machine — which is how the pair
     * came to be green here and red in CI for a week. This one places the three
     * files itself and then walks the camera around them, so nothing is left to
     * drift and every direction is exercised rather than the one this laptop
     * happens to lay out.
     *
     * It holds by arithmetic and not by luck: with three points the 2.5-median
     * clamp cannot bind — two together and one away give distances of d/3, d/3
     * and 2d/3, whose median times 2.5 is always the larger — so `across` is
     * exactly the furthest of them, and the frustum covers 1.13 times that.
     */
    for (const dir of [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
      [0.4, -0.8, 0.45],
      [-0.6, 0.2, -0.77],
    ] as Vec3[]) {
      useGraphStore.getState().select(null)
      useGraphStore.getState().select("ring/0.ts")
      const placed = new Map(useGraphStore.getState().positions)
      // exactly the answer this fixture produces: the file and its two partners
      placed.set("ring/0.ts", [0, 0, 0])
      placed.set("leaf/150.ts", [12, 0, 0])
      placed.set("leaf/151.ts", [0, 900, 0])
      useGraphStore.setState({ positions: placed, lens: "none", vantage: { at: [0, 0, 0], dir } })

      useGraphStore.getState().toggleCoChange()
      const s = useGraphStore.getState()
      expect([...s.coChangeWith.keys()].sort()).toEqual(["leaf/150.ts", "leaf/151.ts"])
      const at = s.viewCentre
      const halfHeight = s.extent * 1.35 * Math.tan((30 * Math.PI) / 180)
      for (const id of ["ring/0.ts", ...s.coChangeWith.keys()]) {
        expect(seenFrom(at, s.positions.get(id)!, dir)).toBeLessThan(halfHeight)
      }
    }
  })

  it("hands the view back when it closes, like every other lens", () => {
    useGraphStore.getState().select("ring/0.ts")
    const before = useGraphStore.getState().nearby
    useGraphStore.getState().toggleCoChange()
    useGraphStore.getState().toggleCoChange()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("none")
    expect(s.coChangeOf).toBeNull()
    expect(s.nearby!.size).toBe(before!.size)
  })

  it("says nothing rather than opening empty when a file travels alone", () => {
    useGraphStore.getState().select("ring/100.ts")
    useGraphStore.getState().toggleCoChange()
    expect(useGraphStore.getState().lens).toBe("none")
  })

  it("stays shut on a graph parsed outside a repository", () => {
    const g = ringWithLeaves()
    delete g.coChange
    useGraphStore.getState().load(g)
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleCoChange()
    expect(useGraphStore.getState().lens).toBe("none")
  })
})

describe("framing across the view", () => {
  // the store is a module singleton: a vantage left behind would change how
  // every later suite frames, which is exactly the bug this block is about
  afterEach(() => useGraphStore.setState({ vantage: null }))

  /**
   * The invariant the whole correction rests on: what a camera has to fit is
   * the part of a set that lies across the view, and that can never be more
   * than the radius around its middle. So handing a lens the direction the
   * reader is standing in can tighten a framing and can never loosen one —
   * which is what makes it safe to give to all of them at once.
   */
  it("never asks the camera to stand further back than it did before", () => {
    const g = ringWithLeaves()
    useGraphStore.getState().load(g)

    for (const dir of [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
      [0.4, -0.8, 0.45],
    ] as Vec3[]) {
      useGraphStore.setState({ vantage: null, lens: "none" })
      useGraphStore.getState().select("ring/0.ts")
      const blind = useGraphStore.getState().extent

      useGraphStore.setState({ vantage: { at: [0, 0, 0], dir }, lens: "none" })
      useGraphStore.getState().select(null)
      useGraphStore.getState().select("ring/0.ts")
      const across = useGraphStore.getState().extent

      expect(across).toBeLessThanOrEqual(blind + 1e-9)
    }
  })

  it("hands the view back unchanged, now that both legs measure the same way", () => {
    /**
     * The risk of giving the direction to every lens at once: if a lens frames
     * across the view and the path back frames around the middle, a round trip
     * lands somewhere else every time. Both legs go through `viewOf`, and this
     * is what says so — with a vantage set, which is the case the plain
     * round-trip test never exercises.
     */
    const g = ringWithLeaves()
    g.hotspots = [{ id: "ring/0.ts", churn: 30, degree: 30 }]
    useGraphStore.getState().load(g)
    useGraphStore.setState({ vantage: { at: [0, 0, 0], dir: [0.4, -0.8, 0.45] }, lens: "none" })
    useGraphStore.getState().select("ring/1.ts")
    const [extent, depth, centre] = [
      useGraphStore.getState().extent,
      useGraphStore.getState().depth,
      useGraphStore.getState().viewCentre,
    ]

    useGraphStore.getState().toggleHotspots()
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect(s.extent).toBe(extent)
    expect(s.depth).toBe(depth)
    expect(s.viewCentre).toEqual(centre)
  })

  it("keeps the depth the camera discards, for the fog", () => {
    // the two are one number only while that number is a radius; the moment the
    // camera measures across the view, the fog needs the other axis or it closes
    // in on a scene that has not got any shallower
    const g = ringWithLeaves()
    useGraphStore.getState().load(g)
    useGraphStore.setState({ vantage: { at: [0, 0, 0], dir: [0, 0, 1] }, lens: "none" })
    useGraphStore.getState().select("ring/0.ts")
    const s = useGraphStore.getState()
    expect(s.depth).toBeGreaterThan(0)
    expect(s.extent).toBeGreaterThan(0)
  })
})

describe("the hotspot lens", () => {
  const withHistory = () => {
    const g = ringWithLeaves()
    // heaviest first, as the parser writes them
    g.hotspots = [
      { id: "leaf/150.ts", churn: 132, degree: 773 },
      { id: "ring/40.ts", churn: 40, degree: 60 },
      { id: "leaf/9.ts", churn: 11, degree: 12 },
    ]
    return g
  }

  beforeEach(() => {
    useGraphStore.setState({ timeline: null, present: null, lens: "none" })
    useGraphStore.getState().load(withHistory())
    useGraphStore.getState().setToastsMounted(true)
  })

  it("answers without being asked about a file, unlike every other lens", () => {
    // it ranks the whole codebase, so there is nothing to point at first.
    // `load` opens on a finding, so the selection has to be dropped to test it
    useGraphStore.getState().select(null)
    expect(useGraphStore.getState().selectedId).toBeNull()
    useGraphStore.getState().toggleHotspots()
    expect(useGraphStore.getState().lens).toBe("hotspots")
  })

  it("turns the parser's order into heat, top of the list at full", () => {
    useGraphStore.getState().toggleHotspots()
    const heat = useGraphStore.getState().hotspotHeat
    expect(heat.get("leaf/150.ts")).toBe(1)
    expect(heat.get("leaf/9.ts")).toBe(0)
    expect(heat.get("ring/40.ts")).toBeGreaterThan(0)
    expect(heat.get("ring/40.ts")).toBeLessThan(1)
    expect(heat.has("ring/1.ts")).toBe(false)
  })

  it("spends its range on the head of the list, where the reader looks", () => {
    /**
     * Three scales were measured on dub's 151 files. Rank spread linearly put
     * the first and the twentieth 7% apart — invisible — and gave the whole
     * range to a tail nobody reads. The log of the product is worse in the
     * other direction: `lib/types.ts` scores 38x the fifth file, so it takes
     * half the range alone. A log of the rank opens the top out to 36%.
     */
    const g = ringWithLeaves()
    g.hotspots = Array.from({ length: 151 }, (_, i) => ({
      id: `ring/${i}.ts`,
      churn: 200 - i,
      degree: 200 - i,
    }))
    useGraphStore.getState().load(g)
    useGraphStore.getState().toggleHotspots()
    const heat = useGraphStore.getState().hotspotHeat
    const head = heat.get("ring/0.ts")! - heat.get("ring/19.ts")!
    const tail = heat.get("ring/100.ts")! - heat.get("ring/119.ts")!
    // twenty places near the top separate the files far more than twenty
    // places do further down, which is the whole point of the log
    expect(head).toBeGreaterThan(tail * 4)
  })

  it("never inverts the parser's order", () => {
    useGraphStore.getState().toggleHotspots()
    const { hotspotHeat, data } = useGraphStore.getState()
    const heats = data!.hotspots!.map((h) => hotspotHeat.get(h.id)!)
    for (let i = 1; i < heats.length; i++) expect(heats[i]!).toBeLessThan(heats[i - 1]!)
  })

  it("keeps the folder its sentence names on screen", () => {
    /**
     * The panel says "23 of its 65 files", so the other 42 have to be drawn or
     * the ratio is a ratio of nothing visible. What the camera frames is a
     * separate question and the answer changed: it used to stand on the named
     * folder because the whole ranking framed came to 1.8px a node, and node
     * size stopped depending on the camera — see the framing test below.
     */
    const g = ringWithLeaves()
    g.hotspots = Array.from({ length: 14 }, (_, i) => ({
      id: `leaf/${i}.ts`,
      churn: 30 - i,
      degree: 30 - i,
    }))
    useGraphStore.getState().load(g)
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()

    // every file of the named folder is drawn, so "14 of its 200" can be seen
    for (const id of ["leaf/0.ts", "leaf/150.ts"]) expect(s.nearby!.has(id)).toBe(true)
    // and the whole ranking stays drawn, because every row of the panel is clickable
    for (const h of g.hotspots!) expect(s.nearby!.has(h.id)).toBe(true)
    expect(s.lens).toBe("hotspots")
  })

  it("leaves the graph exactly as it found it", () => {
    /**
     * The answer is drawn on its own map now — a treemap of the folder tree,
     * over the canvas — so this lens has no business touching what the scene
     * shows. It spent a day trying: reframing put the reader 824 units off the
     * whole repository, and annotating in place left 43% of the ranking out of
     * the frame. Neither was a framing problem.
     */
    useGraphStore.getState().select("ring/0.ts")
    const before = useGraphStore.getState()
    const [drawn, extent, centre] = [before.nearby, before.extent, before.viewCentre]

    useGraphStore.getState().toggleHotspots()
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    // it takes the view and hands it back, the way every framing lens does
    expect(s.lens).toBe("none")
    expect(s.nearby).toEqual(drawn)
    expect(s.extent).toBe(extent)
    expect(s.viewCentre).toEqual(centre)
  })

  it("frames the knot, which is the answer, and the ranking when there is none", () => {
    /**
     * A percentile is not a finding: a p90 cut on two distributions returns
     * about a tenth of the files whatever the repository looks like. What the
     * lens actually reports is the part of the ranking that sits inside an
     * import cycle — files that change constantly and that nobody can change on
     * their own — so that is what the camera stands on, as it does under every
     * other lens. On dub it is 36 files against 150, and 21 of them in one
     * folder, which is small enough to be a place.
     */
    const g = ringWithLeaves()
    g.hotspots = Array.from({ length: 14 }, (_, i) => ({
      id: `leaf/${i}.ts`,
      churn: 30 - i,
      degree: 30 - i,
    }))
    // three of the fourteen are knotted; the other eleven are only ranked
    g.analysis = { orphans: [], cycles: [["leaf/0.ts", "leaf/1.ts", "leaf/2.ts"]] }
    useGraphStore.getState().load(g)
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect([...s.hotspotKnot].sort()).toEqual(["leaf/0.ts", "leaf/1.ts", "leaf/2.ts"])
    for (const k of [0, 1, 2]) {
      const mean = [...s.hotspotKnot].reduce((a, id) => a + s.positions.get(id)![k]! / 3, 0)
      expect(s.viewCentre![k]).toBeCloseTo(mean, 6)
    }
    // and the eleven that are only ranked stay drawn, because their rows click
    for (const h of g.hotspots!) expect(s.nearby!.has(h.id)).toBe(true)
  })

  it("mounts every file the knot touches, not only the ranked ones", () => {
    /**
     * The scene mounts an edge only when both ends are mounted, so a cycle
     * whose unranked members are missing is not a thinner cycle, it is a cut
     * one. Measured on dub: the knot's 273 imports hang off 109 files, 51 of
     * which the ranking and the densest folder had already drawn — 138 of the
     * 273 would have appeared, and half a drawn cycle is a claim the picture
     * cannot support.
     */
    const g = ringWithLeaves()
    // a three-file cycle where only one file is under pressure
    g.edges = [
      ...g.edges,
      { id: "c1", source: "leaf/0.ts", target: "leaf/1.ts", type: "import" as const },
      { id: "c2", source: "leaf/1.ts", target: "leaf/2.ts", type: "import" as const },
      { id: "c3", source: "leaf/2.ts", target: "leaf/0.ts", type: "import" as const },
    ]
    g.hotspots = [{ id: "leaf/0.ts", churn: 30, degree: 30 }]
    g.analysis = { orphans: [], cycles: [["leaf/0.ts", "leaf/1.ts", "leaf/2.ts"]] }
    useGraphStore.getState().load(g)
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()

    expect([...s.hotspotKnot]).toEqual(["leaf/0.ts"])
    expect([...s.hotspotKnotEdges].sort()).toEqual(["c1", "c2", "c3"])
    // the two files that are in the cycle without being in the ranking
    for (const id of ["leaf/1.ts", "leaf/2.ts"]) expect(s.nearby!.has(id)).toBe(true)
    // and they arrive without heat, so the ink recedes them
    expect(s.hotspotHeat.has("leaf/1.ts")).toBe(false)
  })

  it("gathers each knot onto itself without writing the layout", () => {
    /**
     * Drawing the knot's imports made the map worse: its members are scattered
     * by the whole-graph layout, which answers to their external imports too,
     * so every internal one came out as a line across the canvas. Each
     * component is settled on its own instead — `scene/knot.ts` has the
     * measurement that ruled out drawing it as a ring.
     *
     * An override and not a write, so leaving the lens cannot leave the graph
     * deformed. `positions` must come back untouched.
     */
    const g = ringWithLeaves()
    g.edges = [
      ...g.edges,
      { id: "c1", source: "leaf/0.ts", target: "leaf/1.ts", type: "import" as const },
      { id: "c2", source: "leaf/1.ts", target: "leaf/2.ts", type: "import" as const },
      { id: "c3", source: "leaf/2.ts", target: "leaf/0.ts", type: "import" as const },
    ]
    g.hotspots = [{ id: "leaf/0.ts", churn: 30, degree: 30 }]
    g.analysis = { orphans: [], cycles: [["leaf/0.ts", "leaf/1.ts", "leaf/2.ts"]] }
    useGraphStore.getState().load(g)
    const before = new Map(useGraphStore.getState().positions)

    useGraphStore.getState().toggleHotspots()
    const on = useGraphStore.getState()
    expect([...on.hotspotKnotAt.keys()].sort()).toEqual(["leaf/0.ts", "leaf/1.ts", "leaf/2.ts"])
    // the three were scattered across the ring's leaves and now stand together
    const apart = (m: Map<string, Vec3>) => {
      const p = ["leaf/0.ts", "leaf/1.ts", "leaf/2.ts"].map((id) => m.get(id)!)
      return Math.max(
        ...p.flatMap((a) => p.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))),
      )
    }
    expect(apart(on.hotspotKnotAt)).toBeLessThan(apart(before))
    // and every reader sees the new place, the ones outside the knot the old one
    expect(positionOf(on, "leaf/0.ts")).toEqual(on.hotspotKnotAt.get("leaf/0.ts"))
    expect(positionOf(on, "ring/5.ts")).toEqual(before.get("ring/5.ts"))
    expect(on.positions.get("leaf/0.ts")).toEqual(before.get("leaf/0.ts"))

    useGraphStore.getState().toggleHotspots()
    const off = useGraphStore.getState()
    expect(off.hotspotKnotAt.size).toBe(0)
    expect(positionOf(off, "leaf/0.ts")).toEqual(before.get("leaf/0.ts"))
  })

  it("frames the whole ranking when nothing is knotted", () => {
    /**
     * The fallback, and it is the whole lens on a repository with no cycles.
     *
     * It framed one folder for a real reason once: all 150 of dub's hotspots in
     * view put the camera 809 units out at 1.8px a node, against 5.9 for
     * `lib/zod`'s 23. Both figures are node sizes, and a ranked node is now
     * drawn at a fixed eleven pixels wherever it stands (`scene/mark.ts`), so
     * that reason expired and the ranking became framable again.
     */
    const g = ringWithLeaves()
    g.hotspots = Array.from({ length: 14 }, (_, i) => ({
      id: `leaf/${i}.ts`,
      churn: 30 - i,
      degree: 30 - i,
    }))
    useGraphStore.getState().load(g)
    useGraphStore.getState().select("ring/0.ts")
    const wide = useGraphStore.getState().extent

    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("hotspots")
    expect(s.extent).not.toBe(wide)
    expect(s.focusTarget).not.toBeNull()
    // the middle of the ranking, not the middle of any one folder
    const hot = g.hotspots!.map((h) => s.positions.get(h.id)!)
    for (const k of [0, 1, 2]) {
      const mean = hot.reduce((a, p) => a + p[k]! / hot.length, 0)
      expect(s.viewCentre![k]).toBeCloseTo(mean, 6)
    }
  })

  it("measures its reach across the view, not around the centre", () => {
    /**
     * A set framed from further away is not seen from further away in the
     * direction it is deep, and depth is the one direction a fixed-size mark is
     * completely indifferent to. Measured on dub: the ranking's furthest file
     * is 413 from the middle while its half-extents on the three axes are 269,
     * 384 and 240 — so which number the screen's vertical actually gets depends
     * on where the reader happens to be standing, and framing on 413 from an
     * angle that shows the 240 left the constellation in half the height it had
     * been given.
     */
    const g = ringWithLeaves()
    g.hotspots = [0, 1, 2].map((i) => ({ id: `leaf/${i}.ts`, churn: 30 - i, degree: 30 - i }))
    useGraphStore.getState().load(g)
    // two files abreast and one far behind them, seen down the z axis
    const placed = new Map(useGraphStore.getState().positions)
    placed.set("leaf/0.ts", [60, 0, 0])
    placed.set("leaf/1.ts", [-60, 0, 0])
    placed.set("leaf/2.ts", [0, 0, 600])
    // with no vantage there is no view to measure across, which is the state the
    // graph arrives in and the fallback this has to keep working
    useGraphStore.setState({ positions: placed, lens: "none", vantage: null })

    useGraphStore.getState().toggleHotspots()
    const blind = useGraphStore.getState().extent
    useGraphStore.getState().toggleHotspots()

    useGraphStore.getState().setVantage([0, 0, 0], [0, 0, 1])
    useGraphStore.getState().toggleHotspots()
    const across = useGraphStore.getState().extent

    // the 600 of depth counts for nothing; what is left is the 60 abreast
    expect(across).toBeLessThan(blind / 4)
    expect(across).toBeCloseTo(60 * 1.45, 6)

    /**
     * And the depth the camera threw away is kept, because the fog needs it.
     *
     * These were one number and it survived only while that number was a plain
     * radius — wrong for both, but wrong by the same amount. The moment the
     * framing started measuring across the view they parted company, and a fog
     * scaled off the framing would close in on a scene that had not got any
     * shallower. That was patched once by holding the ranked marks out of the
     * fog; the patch is gone, and this is what replaced it.
     */
    const s = useGraphStore.getState()
    // 200, 200 and 400 from the middle along z: the median clamp keeps 400
    expect(s.depth).toBeCloseTo(400 * 1.45, 6)
    expect(s.depth).toBeGreaterThan(s.extent * 6)
  })

  it("follows a row without letting go of the ranking", () => {
    /**
     * `select` spreads `noLens()`, which is right for every lens that answers
     * about a file and wrong here: reading a row is not choosing a new subject,
     * and recomputing `nearby` from that file's neighbourhood would take the
     * other answers off the screen.
     */
    useGraphStore.getState().toggleHotspots()
    const framed = useGraphStore.getState().extent
    const drawn = useGraphStore.getState().nearby
    useGraphStore.getState().pickHotspot("ring/40.ts")
    const s = useGraphStore.getState()
    expect(s.lens).toBe("hotspots")
    expect(s.selectedId).toBe("ring/40.ts")
    expect(s.hotspotHeat.size).toBe(3)
    expect(s.nearby).toBe(drawn)
    // aimed, not moved closer: following the list pans across the ranking
    expect(s.focusTarget).toEqual(s.positions.get("ring/40.ts"))
    expect(s.extent).toBe(framed)
  })

  it("ignores a row that is not in the ranking", () => {
    useGraphStore.getState().toggleHotspots()
    useGraphStore.getState().pickHotspot("ring/100.ts")
    expect(useGraphStore.getState().selectedId).not.toBe("ring/100.ts")
  })

  it("hands the view back when it closes, like every other lens", () => {
    useGraphStore.getState().select("ring/0.ts")
    const before = useGraphStore.getState().nearby
    useGraphStore.getState().toggleHotspots()
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("none")
    expect(s.hotspotHeat.size).toBe(0)
    expect(s.nearby!.size).toBe(before!.size)
  })

  it("stays shut on a graph parsed outside a repository", () => {
    const g = ringWithLeaves()
    delete g.hotspots
    useGraphStore.getState().load(g)
    useGraphStore.getState().toggleHotspots()
    expect(useGraphStore.getState().lens).toBe("none")
  })

  it("turns off the lens it replaces, since two answers at once read as neither", () => {
    useGraphStore.getState().select("ring/0.ts")
    useGraphStore.getState().toggleImpact()
    expect(useGraphStore.getState().lens).toBe("impact")
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("hotspots")
    expect(s.impactOf).toBeNull()
  })
})

describe("what a violation says about a file", () => {
  const withViolations = () => {
    const g = graph("src", ["client.ts", "caller.ts", "loop-a.ts", "loop-b.ts"], "now")
    g.violations = [
      {
        rule: "unique-caller",
        message: "Endpoint called from multiple hooks (client: 2 callers)",
        subject: "client.ts",
        nodeIds: ["client.ts", "caller.ts"],
        edgeIds: [],
      },
      {
        rule: "no-cycles",
        message: "Circular dependency (loop-a → loop-b → loop-a)",
        nodeIds: ["loop-a.ts", "loop-b.ts"],
        edgeIds: [],
      },
    ]
    return g
  }

  it("separates being the subject from being implicated", () => {
    useGraphStore.getState().load(withViolations())
    const found = useGraphStore.getState().violatedNodes
    expect(found.get("client.ts")!.every((v) => v.about)).toBe(true)
    // the caller is listed — it is part of the problem's shape — but not accused
    expect(found.get("caller.ts")!.every((v) => v.about)).toBe(false)
  })

  it("holds every member of a cycle answerable, because no one file holds it", () => {
    useGraphStore.getState().load(withViolations())
    const found = useGraphStore.getState().violatedNodes
    for (const id of ["loop-a.ts", "loop-b.ts"]) {
      expect(found.get(id)!.every((v) => v.about)).toBe(true)
    }
  })

  it("keeps accusing everyone on a graph parsed before the distinction existed", () => {
    // no `subject` anywhere: the old shape, and losing the red on those files
    // would be a silent regression on every graph already written to disk
    const g = withViolations()
    for (const v of g.violations!) delete v.subject
    useGraphStore.getState().load(g)
    const found = useGraphStore.getState().violatedNodes
    expect(found.get("caller.ts")!.every((v) => v.about)).toBe(true)
  })
})

describe("the hotspot lens on a graph that already fits", () => {
  it("comes back to the whole map when the reader lets go first", () => {
    /**
     * The landing's beat does `clear()` then the lens, and it has to: since the
     * lens takes no camera, without letting go it would light the map from
     * wherever the previous beat's question left the camera — on the landing,
     * the co-change answer, which narrows the view to a pair.
     */
    const g = graph("src", ["a.ts", "b.ts", "c.ts"], "now")
    g.hotspots = [{ id: "a.ts", churn: 9, degree: 4 }]
    useGraphStore.getState().load(g)
    useGraphStore.setState({ nearby: new Set(["b.ts"]), viewCentre: [99, 99, 99] })
    useGraphStore.getState().clear()
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("hotspots")
    expect(s.nearby).toBeNull()
    expect(s.focusTarget).not.toBeNull()
  })

  it("recolours the map instead of narrowing it to the ranking", () => {
    /**
     * Narrowing is right where the viewer draws a subset for a render budget:
     * on dub that took 282 files of context off a 151-file answer and moved
     * the camera not at all. It is wrong where the subset *is* the map — the
     * landing's twenty-four files have two hotspots, and the beat came out as
     * two dots in a void.
     */
    const g = graph("src", ["a.ts", "b.ts", "c.ts"], "now")
    g.hotspots = [{ id: "a.ts", churn: 9, degree: 4 }]
    useGraphStore.getState().load(g)
    expect(useGraphStore.getState().skeletonSet).toBeNull()
    useGraphStore.getState().toggleHotspots()
    const s = useGraphStore.getState()
    expect(s.lens).toBe("hotspots")
    // nothing to add: the whole graph was already drawn
    expect(s.nearby).toBeNull()
    expect(s.hotspotHeat.size).toBe(1)
  })
})
