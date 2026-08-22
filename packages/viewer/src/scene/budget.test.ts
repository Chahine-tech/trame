import { describe, expect, it } from "vitest"
import { BUDGET, READABLE } from "./budget"

describe("the two ceilings", () => {
  it("keeps reading well below drawing", () => {
    /**
     * These were one number, and reusing it cost a session to find.
     *
     * 400 is what the renderer can carry. Reading gives out long before that:
     * only a file lit by the selection can be named, and only about twenty-five
     * names clear each other on screen — so a view of 326 files showed 23 names
     * over 303 anonymous dots. Dropping the neighbourhood to 150 left 65 files
     * on screen and 32 of them named. Fewer drawn, more read.
     *
     * If someone folds these back into one constant, that goes with it.
     */
    expect(READABLE).toBeLessThan(BUDGET)
  })

  it("stays wide enough that a neighbourhood is worth opening", () => {
    // the first guess was 80, and it opened one file in seven onto fewer than
    // ten nodes — emptier than the crowd it was meant to fix
    expect(READABLE).toBeGreaterThan(100)
  })
})
