import { useEffect, useRef } from "react"
import { useGraphStore } from "@trame/viewer/store/graph"
import { farthestFrom, subjectOf } from "./subject"

/**
 * The hero performs, then hands over.
 *
 * It drives the product through the very same store actions a visitor would
 * trigger — hover, select, impact — so the landing cannot drift from the tool
 * it is advertising. Each beat also narrates itself: a first-time visitor has
 * no way of knowing that an amber wave is an impact analysis unless the page
 * says so while it happens.
 *
 * The moment anyone touches the page the script stops for good on that
 * gesture — an interface that keeps moving under your cursor is a demo, not
 * a product.
 */

/** Idle time before the performance starts over. Short: a grey graph sells nothing. */
const REPLAY_AFTER = 15_000

export function useHeroScript(
  enabled: boolean,
  onCaption: (text: string | null) => void,
): void {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const stopped = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const store = () => useGraphStore.getState()

    const clearTimers = () => {
      for (const t of timers.current) clearTimeout(t)
      timers.current = []
    }

    const play = () => {
      if (stopped.current) return
      clearTimers()
      const hub = subjectOf()
      if (!hub) return
      const far = farthestFrom(hub.id)

      const { nodes, edges } = store().data ?? { nodes: [], edges: [] }

      // tight enough that a visitor landing at any moment sees something lit
      const beats: { at: number; caption: string | null; run: () => void }[] = [
        {
          // named while it is happening: a graph assembling itself is striking
          // but meaningless until someone says what the shapes stand for
          at: 350,
          caption: `${nodes.length} files, ${edges.length} connections`,
          run: () => {},
        },
        {
          at: 1500,
          caption: `hovering ${hub.label} — its neighbourhood lights up`,
          run: () => store().setHover(hub.id),
        },
        {
          at: 3600,
          caption: `${hub.label} selected — what depends on it?`,
          run: () => store().select(hub.id),
        },
        {
          at: 5000,
          caption: "impact: everything that would break, ring by ring",
          run: () => store().toggleImpact(),
        },
        {
          // a second question, and a second lens: one overlay is a trick, two
          // read as a tool. It also gives the bubble's dot a reason to change
          // colour — amber for impact, lavender for path.
          at: 8200,
          caption: far
            ? `path: how ${hub.label} reaches ${far.label}`
            : "path: the chain between two files",
          run: () => far && store().tracePathTo(far.id),
        },
        { at: 12_000, caption: null, run: () => store().clear() },
      ]
      for (const beat of beats) {
        timers.current.push(
          setTimeout(() => {
            beat.run()
            onCaption(beat.caption)
          }, beat.at),
        )
      }
      timers.current.push(setTimeout(play, REPLAY_AFTER))
    }

    /**
     * A hand on the graph ends the performance, permanently.
     *
     * Scrolling used to end it too, which was right when the page was one
     * screen: the wheel could only mean "I am done watching". Now the wheel is
     * how you move through the page, and killing the demo for using the page
     * would punish exactly the behaviour we are asking for. Only a pointer on
     * the scene counts — that is someone reaching for the graph itself.
     */
    const surrender = () => {
      stopped.current = true
      clearTimers()
      store().clear()
      onCaption(null)
    }
    window.addEventListener("pointerdown", surrender, { once: true })

    play()

    return () => {
      clearTimers()
      window.removeEventListener("pointerdown", surrender)
    }
  }, [enabled, onCaption])
}
