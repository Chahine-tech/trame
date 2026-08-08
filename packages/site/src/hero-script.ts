import { useEffect, useRef } from "react"
import { useGraphStore } from "@trame/viewer/store/graph"

/**
 * The hero proves the graph is alive. It does not teach.
 *
 * It used to run the whole product — select, impact, path — because the page
 * was one screen and there was nowhere else to show anything. Now the scrolled
 * sections own the lenses, each with a heading and a paragraph to make sense
 * of it, and the hero playing them first meant every visitor met the amber
 * wave twice: once unexplained, then again properly. The worse version came
 * first, which is the wrong way round.
 *
 * So what is left here names no feature. The arrival cascade is the spectacle;
 * a wandering hover keeps the graph from settling into a photograph; and one
 * caption states a fact — how many files, how many connections — which tells a
 * visitor what they are looking at without spending a lens on it.
 *
 * The first time anyone sees an overlay is in the section built to explain it.
 */

/** How long each node holds the hover before the attention moves on. */
const HOVER_EVERY = 2800

/** Nodes worth pausing on: enough neighbours that lighting them shows something. */
const MIN_DEGREE = 3

function wanderOrder(): string[] {
  const { data, adjacency } = useGraphStore.getState()
  if (!data) return []
  return data.nodes
    .filter((n) => (adjacency.get(n.id)?.size ?? 0) >= MIN_DEGREE)
    .map((n) => n.id)
    // sorted, so the tour is the same on every visit — like the cascade
    .sort()
}

export function useHeroScript(
  enabled: boolean,
  onCaption: (text: string | null) => void,
): void {
  // one holds the delay before the tour starts, the other the tour itself —
  // they are different kinds of handle and stashing both in one ref only
  // worked because browsers happen to share an id space
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    /**
     * Leaving the hero must take the caption with it.
     *
     * Gating on `enabled` stopped the timers but left the last line it had
     * written on screen, so scrolling into a section kept a bubble describing
     * the hero over a graph showing something else entirely.
     */
    if (!enabled) {
      onCaption(null)
      return
    }

    const store = () => useGraphStore.getState()
    const { nodes, edges } = store().data ?? { nodes: [], edges: [] }
    // a fact, not a feature: it stays up rather than flashing for one beat
    onCaption(`${nodes.length} files, ${edges.length} connections`)

    const tour = wanderOrder()
    let i = 0
    const step = () => {
      const id = tour[i % tour.length]
      if (id) store().setHover(id)
      i++
    }
    const stop = () => {
      if (delay.current) clearTimeout(delay.current)
      if (tick.current) clearInterval(tick.current)
    }

    if (tour.length > 0) {
      // the cascade needs the screen to itself before attention lands anywhere
      delay.current = setTimeout(() => {
        step()
        tick.current = setInterval(step, HOVER_EVERY)
      }, 1800)
    }

    /**
     * A hand on the graph ends the wandering, permanently.
     *
     * Only a pointer on the scene counts — the wheel is how you move through
     * the page now, and stopping the demo for scrolling would punish exactly
     * the gesture the page is asking for.
     */
    const surrender = () => {
      stop()
      store().clear()
    }
    window.addEventListener("pointerdown", surrender, { once: true })

    return () => {
      stop()
      window.removeEventListener("pointerdown", surrender)
    }
  }, [enabled, onCaption])
}
