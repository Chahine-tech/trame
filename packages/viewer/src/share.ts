import { useEffect, useRef } from "react"
import { useGraphStore } from "./store/graph"
import type { LensKind } from "./store/lens"

/**
 * A view of the graph, encoded in the URL.
 *
 * Architecture conversations are about a particular file — "look at what this
 * one touches" — and until now the only way to have that conversation was to
 * describe the clicks. This makes the view itself the message.
 *
 * In the hash rather than the query string, for two reasons: it never reaches
 * a server, and it is not carried in the Referer header when someone follows a
 * link out of the page. A file path is not a secret, but it is nobody else's
 * business either.
 */
export interface SharedView {
  /** the selected file */
  node?: string
  /** the far end, for a traced path */
  to?: string
  lens?: LensKind
}

const SHAREABLE: LensKind[] = ["impact", "path", "whatif"]

export function encodeView(view: SharedView): string {
  const parts: string[] = []
  if (view.node) parts.push(`node=${encodeURIComponent(view.node)}`)
  if (view.to) parts.push(`to=${encodeURIComponent(view.to)}`)
  if (view.lens && view.lens !== "none") parts.push(`lens=${view.lens}`)
  return parts.length > 0 ? `#${parts.join("&")}` : ""
}

export function decodeView(hash: string): SharedView {
  const view: SharedView = {}
  for (const pair of hash.replace(/^#/, "").split("&")) {
    const [key, raw] = pair.split("=")
    if (!raw) continue
    const value = decodeURIComponent(raw)
    if (key === "node") view.node = value
    if (key === "to") view.to = value
    // an unknown lens from a hand-edited link must not put the store in a
    // state none of its actions can produce
    if (key === "lens" && SHAREABLE.includes(value as LensKind)) view.lens = value as LensKind
  }
  return view
}

/** The link to the view currently on screen, absolute and ready to paste. */
export function shareUrl(): string {
  const { selectedId, lens, pathNodes } = useGraphStore.getState()
  const view: SharedView = {
    node: selectedId ?? undefined,
    lens: SHAREABLE.includes(lens) ? lens : undefined,
    to: lens === "path" ? pathNodes[pathNodes.length - 1] : undefined,
  }
  return `${location.origin}${location.pathname}${encodeView(view)}`
}

/**
 * Replay a shared view through the store's own actions.
 *
 * Not by writing the lens state directly: going through `select` and
 * `toggleImpact` means a link can only ever reproduce a state the tool can
 * reach on its own, and it inherits every guard those actions already have.
 */
function applyView(view: SharedView): void {
  const store = useGraphStore.getState()
  if (!view.node || !store.data?.nodes.some((n) => n.id === view.node)) return

  store.select(view.node)
  store.focus(view.node)
  if (view.lens === "impact") store.toggleImpact()
  else if (view.lens === "whatif") store.toggleWhatIf()
  else if (view.lens === "path" && view.to) store.tracePathTo(view.to)
}

/**
 * Keeps the address bar and the graph saying the same thing.
 *
 * The URL is rewritten with replaceState, never pushState: a lens is not a
 * page, and filling someone's back button with every node they clicked would
 * make leaving the tool a chore.
 */
export function useShareLink(): void {
  const data = useGraphStore((s) => s.data)
  const selectedId = useGraphStore((s) => s.selectedId)
  const lens = useGraphStore((s) => s.lens)
  const applied = useRef(false)

  // once the graph exists, an incoming link gets its turn — but only the first
  // one, or a watch-mode reload would drag the view back to where it started
  useEffect(() => {
    if (!data || applied.current) return
    applied.current = true
    const view = decodeView(location.hash)
    if (view.node) applyView(view)
  }, [data])

  useEffect(() => {
    if (!applied.current) return
    const next = `${location.pathname}${location.search}${encodeView({
      node: selectedId ?? undefined,
      lens: SHAREABLE.includes(lens) ? lens : undefined,
      to: lens === "path" ? useGraphStore.getState().pathNodes.at(-1) : undefined,
    })}`
    history.replaceState(null, "", next)
  }, [selectedId, lens])
}
