import { describe, expect, it } from "vitest"
import { blockedBecause, LENSES } from "./lens"

describe("whether a lens can answer", () => {
  const nothing = { selectedId: null, hasTimeline: false, hasCoChange: true }
  const chosen = { selectedId: "a.ts", hasTimeline: false, hasCoChange: true }

  it("asks for a file before answering a question about one", () => {
    expect(blockedBecause("impact", nothing)).toBeTruthy()
    expect(blockedBecause("whatif", nothing)).toBeTruthy()
    expect(blockedBecause("impact", chosen)).toBeNull()
    expect(blockedBecause("whatif", chosen)).toBeNull()
  })

  it("names the second click a path is waiting for, before there is a first", () => {
    // once a file is chosen the gesture is ready to receive its second half,
    // so the chip is live and its own label carries the "shift-click"
    expect(blockedBecause("path", nothing)).toContain("shift-click")
    expect(blockedBecause("path", chosen)).toBeNull()
  })

  it("asks for a replay to exist rather than for a selection", () => {
    // history is a property of the repository, not of what is on screen
    expect(blockedBecause("replay", chosen)).toBeTruthy()
    expect(blockedBecause("replay", { selectedId: null, hasTimeline: true, hasCoChange: true })).toBeNull()
  })

  it("says what it is waiting for, never just that it is unavailable", () => {
    // a dimmed control always provokes "why", and the bar has to answer it
    for (const kind of ["impact", "path", "whatif", "replay"] as const) {
      const why = blockedBecause(kind, nothing)
      expect(why).toMatch(/Select|Run/)
    }
  })

  it("has a name and an accent for every lens the bar can show", () => {
    for (const kind of ["impact", "path", "whatif", "replay"] as const) {
      expect(LENSES[kind].label).toBeTruthy()
      expect(LENSES[kind].accent).toBeTruthy()
    }
  })
})
