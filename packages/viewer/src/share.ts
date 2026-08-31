import { useEffect, useRef } from "react"
import { useGraphStore } from "./store/graph"
import type { LensKind } from "./store/lens"

/**
 * A view of the graph, encoded in the URL.
 *
 * Architecture conversations are about a particular file, "look at what this
 * one touches", and until now the only way to have that conversation was to
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

// three of them: a Set here would be slower to build than the scan it saves
/**
 * Which lenses a link may carry.
 *
 * `hotspots` was missing, and it is the one that most needed to be here: it
 * asks nothing of the reader, so it is the only lens whose link names no file —
 * and a link naming no file was thrown away on arrival. The address of the
 * finding, the one worth sending anybody, did not exist.
 *
 * `cochange` belongs here for the opposite reason to `hotspots`: it answers
 * about a file the way `impact` does, so its link carries one, and "what moves
 * with this file that nothing imports" is exactly the kind of thing a reader
 * sends to somebody else.
 *
 * `replay` is not here and should not be: it is a sequence being played, not a
 * state, so an address for it would name a moment nobody can return to.
 */
const SHAREABLE: LensKind[] = ["impact", "path", "whatif", "hotspots", "cochange"]

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

  /**
   * A link that names no file, which is what the hotspot lens' link is.
   *
   * Every other lens answers about a file, so every other link carries one, and
   * the guard here used to be `if (!view.node) return`. That silently discarded
   * the address of the only answer about the whole repository.
   */
  if (!view.node) {
    if (view.lens === "hotspots" && store.lens !== "hotspots") store.toggleHotspots()
    return
  }

  if (!store.data?.nodes.some((n) => n.id === view.node)) return
  store.select(view.node)
  store.focus(view.node)
  if (view.lens === "impact") store.toggleImpact()
  else if (view.lens === "whatif") store.toggleWhatIf()
  else if (view.lens === "hotspots") store.toggleHotspots()
  else if (view.lens === "cochange") store.toggleCoChange()
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

  // once the graph exists, an incoming link gets its turn, but only the first
  // one, or a watch-mode reload would drag the view back to where it started
  useEffect(() => {
    if (!data || applied.current) return
    applied.current = true
    const view = decodeView(location.hash)
    // a lens can be the whole link: see `applyView`
    if (view.node || view.lens) applyView(view)
  }, [data])

  /**
   * A link pasted into the address bar of an open page is a gesture, and it
   * used to do nothing at all: the guard above fires once per load, so the
   * second link only rewrote the hash while the view stayed put. It reads as
   * the tool ignoring you, and it is how a lens that worked looked broken.
   *
   * Distinct from the guard, which exists for a reload of the *data*. This is
   * the reader asking. `replaceState` below does not raise `hashchange`, so
   * writing the URL back cannot loop through here.
   */
  useEffect(() => {
    const onHash = () => {
      if (!useGraphStore.getState().data) return
      const view = decodeView(location.hash)
      if (view.node || view.lens) applyView(view)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

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
