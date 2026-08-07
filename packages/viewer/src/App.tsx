import { useEffect, useState } from "react"
import { GooeyToaster } from "goey-toast"
import "goey-toast/styles.css"
import { useGraphStore } from "./store/graph"
import { isDarkGround, usePalette } from "./theme"
import {
  toastGraphUpdated,
  toastNeedsSelection,
  toastOpeningEditor,
  toastParseFailed,
  toastToggled,
  toastViolations,
} from "./ui/toast"
import { TopBar } from "./ui/TopBar"
import { Inspector } from "./ui/Inspector"
import { Palette } from "./ui/Palette"
import { Shortcuts } from "./ui/Shortcuts"
import { FirstRunHint } from "./ui/FirstRunHint"
import { subscribeToGraph } from "./graph-feed"
import { EDITOR_LABEL, getEditor, openInEditor } from "./editor"

export function AppUI() {
  const palette = usePalette()
  const load = useGraphStore((s) => s.load)
  const clear = useGraphStore((s) => s.clear)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const resetCamera = useGraphStore((s) => s.resetCamera)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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

      // hot-swap when the parser rewrites the file
      const next = event.data
      const current = useGraphStore.getState().data
      if (!current || next.meta.generated === current.meta.generated) return

      const delta = next.meta.nodeCount - current.meta.nodeCount
      const before = current.violations?.length ?? 0
      const after = next.violations?.length ?? 0
      load(next)
      // a failed parse serves the last good graph — say so instead of
      // letting a stale architecture look current
      if (next.meta.error) toastParseFailed(next.meta.error)
      else {
        toastGraphUpdated(next.meta.nodeCount, delta)
        // that save broke a rule — surface it now, not at CI time
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
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault()
        useGraphStore.getState().requestPng()
        return
      }
      if (e.key === "Escape") {
        if (shortcutsOpen) setShortcutsOpen(false)
        else if (paletteOpen) setPaletteOpen(false)
        else clear()
        return
      }
      if (typing || paletteOpen) return

      if (e.key === "?") {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
      } else if (shortcutsOpen) {
        return // the panel is the focus — no stray shortcuts behind it
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
        // labels only draw on lit nodes, so the toggle can look like a no-op
        toastToggled("Labels", !s.showLabels)
      } else if (e.key.toLowerCase() === "e") {
        useGraphStore.getState().cycleEdgeFilter()
      } else if (e.key.toLowerCase() === "i") {
        useGraphStore.getState().toggleImpact()
      } else if (e.key.toLowerCase() === "o") {
        const s = useGraphStore.getState()
        const node = s.data?.nodes.find((n) => n.id === s.selectedId)
        if (node?.file) {
          openInEditor(node.file, node.line)
          toastOpeningEditor(EDITOR_LABEL[getEditor()], `${node.id}:${node.line}`)
        } else toastNeedsSelection("Open in editor")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [paletteOpen, shortcutsOpen, clear, select, focus, resetCamera])

  return (
    <>
      <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} />
      <Inspector />
      <FirstRunHint />
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
        // bottom-left: the inspector owns the right edge, and two floating
        // surfaces overlapping reads as broken
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
