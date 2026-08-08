import { useEffect, useRef } from "react"
import { useGraphStore } from "@trame/viewer/store/graph"

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

/**
 * The subject has to work for *both* beats, which pull in opposite directions.
 *
 * Hover shows a neighbourhood: it only reads if it is clearly a subset. The
 * busiest file here touches 16 of the other 23, so hovering it lit 71% of the
 * graph — no figure left against the ground.
 *
 * Impact shows transitive dependents, and there the point is that it is large:
 * "everything that would break" has to look like a wave. Optimising for a small
 * neighbourhood alone picks a leaf, whose impact set is two nodes and whose
 * amber wave shows nothing at all.
 *
 * So: score the neighbourhood toward a readable fraction, and reward a wide
 * blast radius. Derived from the graph, never a hard-coded filename, so this
 * survives a change of demo codebase.
 */
const IDEAL_NEIGHBOURHOOD = 0.3

function subjectOf(): { id: string; label: string } | null {
  const { data, adjacency, importers } = useGraphStore.getState()
  if (!data || data.nodes.length === 0) return null
  const total = data.nodes.length

  const blastRadius = (id: string): number => {
    const seen = new Set([id])
    let frontier = [id]
    while (frontier.length > 0) {
      const next: string[] = []
      for (const x of frontier) {
        for (const importer of importers.get(x) ?? []) {
          if (seen.has(importer)) continue
          seen.add(importer)
          next.push(importer)
        }
      }
      frontier = next
    }
    return seen.size / total
  }

  let best: { id: string; label: string } | null = null
  let bestScore = -Infinity
  for (const node of data.nodes) {
    const neighbourhood = ((adjacency.get(node.id)?.size ?? 0) + 1) / total
    // distance from a readable neighbourhood dominates; blast radius breaks ties
    const score = -Math.abs(neighbourhood - IDEAL_NEIGHBOURHOOD) * 3 + blastRadius(node.id)
    if (score > bestScore) {
      bestScore = score
      best = { id: node.id, label: node.label }
    }
  }
  return best
}

/** Idle time before the performance starts over. Short: a grey graph sells nothing. */
const REPLAY_AFTER = 12_500

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
        { at: 9500, caption: null, run: () => store().clear() },
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

    // the visitor taking the mouse ends the performance, permanently
    const surrender = () => {
      stopped.current = true
      clearTimers()
      store().clear()
      onCaption(null)
    }
    window.addEventListener("pointerdown", surrender, { once: true })
    window.addEventListener("wheel", surrender, { once: true, passive: true })

    play()

    return () => {
      clearTimers()
      window.removeEventListener("pointerdown", surrender)
      window.removeEventListener("wheel", surrender)
    }
  }, [enabled, onCaption])
}
