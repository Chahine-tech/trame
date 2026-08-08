import { useEffect, useRef } from "react"
import { useGraphStore } from "@trame/viewer/store/graph"
import type { Timeline } from "@trame/viewer/types"

/** How long each commit holds the screen. Slow enough to read the subject line. */
const FRAME_MS = 1100

/**
 * The architecture growing through git history, driven by the page.
 *
 * This is the one section that cannot be a single store call: the others ask a
 * question and the answer stays on screen, while a replay is a sequence that
 * has to be walked and then wound back when the visitor leaves. So the section
 * declares the lens and this owns the playback.
 *
 * The timeline is 222 kB against the graph's 17 — an order of magnitude more —
 * so it is fetched on approach rather than up front. Everything the page did
 * today to keep the first paint clear would be undone by loading it eagerly for
 * a section most visitors never reach.
 */
export function useReplay(active: boolean, armed: boolean): void {
  const timeline = useGraphStore((s) => s.timeline)
  const loadTimeline = useGraphStore((s) => s.loadTimeline)
  const fetched = useRef(false)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  // fetched once the visitor is a section away, so it has landed by arrival
  useEffect(() => {
    if (!armed || fetched.current) return
    fetched.current = true
    const controller = new AbortController()
    fetch("/replay.json", { signal: controller.signal })
      .then((r) => r.json() as Promise<Timeline>)
      .then((t) => t.frames?.length && loadTimeline(t))
      .catch(() => {
        /* the section still reads; it simply will not move */
      })
    return () => controller.abort()
  }, [armed, loadTimeline])

  useEffect(() => {
    if (!active || !timeline) return
    const store = () => useGraphStore.getState()
    store().enterReplay()

    let i = 0
    tick.current = setInterval(() => {
      i++
      if (i >= timeline.frames.length) {
        // hold on the present rather than looping — the point is that this is
        // where the codebase arrived, not that it keeps arriving
        if (tick.current) clearInterval(tick.current)
        return
      }
      store().showFrame(i)
    }, FRAME_MS)

    return () => {
      if (tick.current) clearInterval(tick.current)
      // put the live graph back, or the sections above would be scrolled into
      // showing whichever commit the replay happened to stop on
      store().exitReplay()
    }
  }, [active, timeline])
}
