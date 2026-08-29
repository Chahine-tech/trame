import { useEffect, useRef } from "react"
import { useGraphStore } from "@trame/viewer/store/graph"

/**
 * The hero runs no lens.
 *
 * It used to play select, impact and path. The scrolled sections now explain
 * each of those, so a visitor met the same overlay twice, unexplained first.
 * What is left is the arrival cascade, a wandering hover, and a caption.
 */

/** How long each node holds the hover before the attention moves on. */
const HOVER_EVERY = 2800

/** Nodes worth pausing on: enough neighbours that lighting them shows something. */
const MIN_DEGREE = 3

function wanderOrder(): string[] {
  const { data, adjacency } = useGraphStore.getState()
  if (!data) return []
  return (
    data.nodes
      .filter((n) => (adjacency.get(n.id)?.size ?? 0) >= MIN_DEGREE)
      .map((n) => n.id)
      // sorted, so the tour is the same on every visit
      .sort()
  )
}

export function useHeroScript(enabled: boolean, onCaption: (text: string | null) => void): void {
  // separate refs: a timeout handle and an interval handle. Sharing one ref
  // only worked because browsers happen to share an id space between them.
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // gating on `enabled` alone stopped the timers but left the last caption
    // on screen, over a section showing something else
    if (!enabled) {
      onCaption(null)
      return
    }

    const store = () => useGraphStore.getState()
    const { nodes, edges } = store().data ?? { nodes: [], edges: [] }
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

    // pointer only, not the wheel: scrolling is how you read this page, and
    // stopping the demo for it would punish the gesture the page asks for
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
