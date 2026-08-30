import { useEffect, useState } from "react"
import { GooeyToaster } from "goey-toast"
import "goey-toast/styles.css"
import { useGraphStore } from "./store/graph"
import { isDarkGround, usePalette } from "./theme"
import {
  toastGraphUpdated,
  toastNeedsSelection,
  toastNoReplay,
  toastOpeningEditor,
  toastParseFailed,
  toastToggled,
  toastViolations,
} from "./ui/toast"
import { TopBar } from "./ui/TopBar"
import { Hotspots } from "./ui/Hotspots"
import { Findings } from "./ui/Findings"
import { Inspector } from "./ui/Inspector"
import { Palette } from "./ui/Palette"
import { Shortcuts } from "./ui/Shortcuts"
import { FirstRunHint } from "./ui/FirstRunHint"
import { LensBar } from "./ui/LensBar"
import { Timeline as TimelineBar } from "./ui/Timeline"
import { subscribeToGraph, subscribeToTimeline } from "./graph-feed"
import { useShareLink } from "./share"
import { EDITOR_LABEL, getEditor, locate, openInEditor } from "./editor"

export function AppUI() {
  // the address bar follows the view, and an incoming link restores one
  useShareLink()

  const palette = usePalette()
  const load = useGraphStore((s) => s.load)
  const clear = useGraphStore((s) => s.clear)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const resetCamera = useGraphStore((s) => s.resetCamera)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // this is the only host that mounts a toaster; the landing drives the same
  // store without one, and must not be offered notices it cannot draw
  useEffect(() => {
    useGraphStore.getState().setToastsMounted(true)
    return () => useGraphStore.getState().setToastsMounted(false)
  }, [])

  // a replay, if one was generated; it takes over from the live graph
  useEffect(() => subscribeToTimeline((t) => useGraphStore.getState().loadTimeline(t)), [])

  // initial load + watch-mode live reload, both owned by the feed
  useEffect(() => {
    return subscribeToGraph((event) => {
      if (event.kind === "loaded") {
        load(event.data)
        return
      }
      if (event.kind === "demo") {
        load(event.data, true)
        return
      }

      const next = event.data
      const state = useGraphStore.getState()

      // While the replay is on screen the poll must not touch the graph: the
      // frame it shows is history, and its timestamp differs from the live one
      // on every tick. Park the newest present instead, so leaving the replay
      // returns to the current architecture rather than the one from entry.
      if (state.lens === "replay") {
        useGraphStore.setState({ present: next })
        return
      }

      // hot-swap when the parser rewrites the file
      const current = state.data
      if (!current || next.meta.generated === current.meta.generated) return

      const delta = next.meta.nodeCount - current.meta.nodeCount
      const before = current.violations?.length ?? 0
      const after = next.violations?.length ?? 0
      load(next)
      // a failed parse serves the last good graph, so say so instead of
      // letting a stale architecture look current
      if (next.meta.error) toastParseFailed(next.meta.error)
      else {
        toastGraphUpdated(next.meta.nodeCount, delta)
        // that save broke a rule: surface it now, not at CI time
        if (after > before) toastViolations(after)
      }
    })
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT"

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      // only while the notice offering it is still up, which is what `cleared`
      // tracks. Not on `esc`: that key walks *out* of the view, and one key
      // doing both directions would bounce the reader between two floors
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (!useGraphStore.getState().cleared) return
        e.preventDefault()
        useGraphStore.getState().restoreCleared()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault()
        useGraphStore.getState().requestPng()
        return
      }
      if (e.key === "Escape") {
        // walk back one layer at a time rather than wiping everything: panel,
        // then the lens, then the selection itself
        if (shortcutsOpen) setShortcutsOpen(false)
        else if (paletteOpen) setPaletteOpen(false)
        // a list is a panel, so it goes before the lens on the way out
        else if (useGraphStore.getState().browsing) useGraphStore.getState().browse(null)
        else if (useGraphStore.getState().lens === "replay") useGraphStore.getState().exitReplay()
        else if (useGraphStore.getState().lens !== "none") useGraphStore.getState().clearLens()
        else clear()
        return
      }
      if (typing || paletteOpen) return

      if (e.key === "?") {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (shortcutsOpen) {
        return // the panel is the focus, no stray shortcuts behind it
      } else if (e.key === "/") {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (e.key === " ") {
        e.preventDefault()
        resetCamera()
      } else if (e.key.toLowerCase() === "f") {
        const id = useGraphStore.getState().selectedId
        if (id) {
          select(id)
          focus(id)
        } else toastNeedsSelection("Focus")
      } else if (e.key.toLowerCase() === "g") {
        useGraphStore.getState().toggleClusters()
      } else if (e.key.toLowerCase() === "l") {
        const s = useGraphStore.getState()
        s.toggleLabels()
        // at file level labels only draw on a lit node, so the toggle can look
        // like a no-op; in district mode the effect is immediate and obvious
        if (!s.districtMode) toastToggled("Labels", !s.showLabels)
      } else if (e.key.toLowerCase() === "e") {
        useGraphStore.getState().cycleEdgeFilter()
      } else if (e.key.toLowerCase() === "i") {
        useGraphStore.getState().toggleImpact()
      } else if (e.key.toLowerCase() === "w") {
        useGraphStore.getState().toggleWhatIf()
      } else if (e.key.toLowerCase() === "c") {
        useGraphStore.getState().toggleCoChange()
      } else if (e.key.toLowerCase() === "h") {
        useGraphStore.getState().toggleHotspots()
      } else if (e.key.toLowerCase() === "r") {
        const s = useGraphStore.getState()
        if (s.lens === "replay") s.exitReplay()
        else if (s.timeline) s.enterReplay()
        else toastNoReplay()
      } else if (e.key.toLowerCase() === "o") {
        const s = useGraphStore.getState()
        const node = s.data?.nodes.find((n) => n.id === s.selectedId)
        const here = locate(node?.file, s.data?.meta.root)
        if (here && node) {
          openInEditor(here, node.line)
          toastOpeningEditor(EDITOR_LABEL[getEditor()], `${node.id}:${node.line}`)
        } else toastNeedsSelection("Open in editor")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [paletteOpen, shortcutsOpen, clear, select, focus, resetCamera])

  return (
    <>
      <TopBar
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <Inspector />
      <Findings />
      <Hotspots />
      <LensBar />
      <FirstRunHint />
      <TimelineBar />
      <Palette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onShowShortcuts={() => {
          setPaletteOpen(false)
          setShortcutsOpen(true)
        }}
      />
      <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <GooeyToaster
        key={palette.base}
        /**
         * Bottom-left, and one place in the whole app: toasts that move around
         * read as three different mechanisms. Every other edge is spoken for —
         * the inspector owns the right, the replay timeline and the first-run
         * hint own the centre, the top bar owns the top.
         *
         * The lens bar shares this corner and got covered for a while. It is
         * cleared by lifting the stack in `styles.css`, where the rest of the
         * screen's geometry already lives, rather than by moving the toasts
         * somewhere they would collide with something else.
         */
        position="bottom-left"
        theme={isDarkGround() ? "dark" : "light"}
        preset="subtle"
        bounce={0.08}
        showTimestamp={false}
        // esc belongs to the graph (deselect), not to the toasts
        closeOnEscape={false}
        closeButton="top-right"
        maxQueue={3}
        queueOverflow="drop-oldest"
      />
    </>
  )
}
