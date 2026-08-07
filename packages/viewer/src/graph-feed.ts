import { DEMO } from "./demo-data"
import type { GraphData } from "./types"

const SOURCE = "/archviz.json"
const POLL_MS = 2500

export type GraphFeedEvent =
  /** First successful read of the generated graph. */
  | { kind: "loaded"; data: GraphData }
  /** No generated graph on disk — the bundled sample stands in. */
  | { kind: "demo"; data: GraphData }
  /** A later read from watch mode; the caller decides if it actually changed. */
  | { kind: "updated"; data: GraphData }

/**
 * The single reader of archviz.json: one initial load, then a watch poll.
 *
 * Requests are strictly sequential — the next one is only scheduled once the
 * previous has settled — so a slow response can never land on top of a newer
 * graph. Unsubscribing aborts whatever is in flight and drops its result.
 */
export function subscribeToGraph(onEvent: (event: GraphFeedEvent) => void): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const read = async (cache: RequestCache): Promise<GraphData> => {
    const r = await fetch(SOURCE, { cache, signal: controller.signal })
    if (!r.ok) throw new Error(`archviz.json responded ${r.status}`)
    return (await r.json()) as GraphData
  }

  const scheduleNext = () => {
    if (stopped) return
    timer = setTimeout(async () => {
      try {
        const data = await read("no-store")
        if (!stopped) onEvent({ kind: "updated", data })
      } catch {
        /* server briefly unavailable, or we were aborted — retry next tick */
      }
      scheduleNext()
    }, POLL_MS)
  }

  void (async () => {
    try {
      const data = await read("default")
      if (!stopped) onEvent({ kind: "loaded", data })
    } catch {
      if (!stopped) onEvent({ kind: "demo", data: DEMO })
    }
    scheduleNext()
  })()

  return () => {
    stopped = true
    controller.abort()
    clearTimeout(timer)
  }
}
