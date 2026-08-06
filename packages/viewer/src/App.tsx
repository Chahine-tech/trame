import { useEffect, useState } from "react"
import { useGraphStore } from "./store/graph"
import { TopBar } from "./ui/TopBar"
import { Inspector } from "./ui/Inspector"
import { Palette } from "./ui/Palette"
import { DEMO } from "./demo-data"
import type { GraphData } from "./types"

export function AppUI() {
  const load = useGraphStore((s) => s.load)
  const clear = useGraphStore((s) => s.clear)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const resetCamera = useGraphStore((s) => s.resetCamera)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    fetch("/archviz.json")
      .then((r) => (r.ok ? (r.json() as Promise<GraphData>) : Promise.reject(new Error("no data"))))
      .then(load)
      .catch(() => load(DEMO))
  }, [load])

  // watch-mode live reload: hot-swap when the parser rewrites the file
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const r = await fetch("/archviz.json", { cache: "no-store" })
        if (!r.ok) return
        const next = (await r.json()) as GraphData
        const current = useGraphStore.getState().data
        if (current && next.meta.generated !== current.meta.generated) load(next)
      } catch {
        /* server briefly unavailable — retry next tick */
      }
    }, 2500)
    return () => clearInterval(interval)
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
        if (paletteOpen) setPaletteOpen(false)
        else clear()
        return
      }
      if (typing || paletteOpen) return

      if (e.key === "/") {
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
        }
      } else if (e.key.toLowerCase() === "g") {
        useGraphStore.getState().toggleClusters()
      } else if (e.key.toLowerCase() === "l") {
        useGraphStore.getState().toggleLabels()
      } else if (e.key.toLowerCase() === "e") {
        useGraphStore.getState().cycleEdgeFilter()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [paletteOpen, clear, select, focus, resetCamera])

  return (
    <>
      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <Inspector />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}
