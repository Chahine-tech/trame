import { Command } from "cmdk"
import { exportGraph, useGraphStore } from "../store/graph"
import { NODE_COLOR, usePalette } from "../theme"

/**
 * ⌘K command palette. Opened 100+ times a day → zero animation, ever
 * (frequency rule — Raycast has no open/close animation either).
 */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const select = useGraphStore((s) => s.select)
  const focus = useGraphStore((s) => s.focus)
  const resetCamera = useGraphStore((s) => s.resetCamera)

  if (!open || !data) return null

  const goTo = (id: string) => {
    select(id)
    focus(id)
    onClose()
  }

  const download = () => {
    const json = exportGraph()
    if (!json) return
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "archviz.json"
    a.click()
    URL.revokeObjectURL(url)
    onClose()
  }

  return (
    <>
      <div className="palette-overlay" onClick={onClose} />
      <Command className="palette" label="Command palette">
        <Command.Input autoFocus placeholder="Search nodes, commands…" />
        <Command.List>
          <Command.Empty>no results</Command.Empty>
          <Command.Group heading="go to">
            {data.nodes.map((n) => (
              <Command.Item key={n.id} value={`${n.label} ${n.id}`} onSelect={() => goTo(n.id)}>
                <span className="g" style={{ background: palette[NODE_COLOR[n.type]] }} />
                <span className="lbl">{n.label}</span>
                <span className="path">{n.cluster}/</span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="commands">
            <Command.Item
              value="reset camera center"
              onSelect={() => {
                resetCamera()
                onClose()
              }}
            >
              <span className="lbl">Reset camera</span>
              <span className="path">space</span>
            </Command.Item>
            <Command.Item
              value="export png screenshot"
              onSelect={() => {
                onClose()
                useGraphStore.getState().requestPng()
              }}
            >
              <span className="lbl">Export PNG</span>
              <span className="path">⌘E</span>
            </Command.Item>
            <Command.Item value="export json curves" onSelect={download}>
              <span className="lbl">Export archviz.json (curves included)</span>
            </Command.Item>
            <Command.Item
              value="cycle edge filter type"
              onSelect={() => useGraphStore.getState().cycleEdgeFilter()}
            >
              <span className="lbl">Cycle edge filter</span>
              <span className="path">E</span>
            </Command.Item>
            <Command.Item
              value="toggle labels"
              onSelect={() => useGraphStore.getState().toggleLabels()}
            >
              <span className="lbl">Toggle labels</span>
              <span className="path">L</span>
            </Command.Item>
            <Command.Item
              value="toggle folder labels"
              onSelect={() => useGraphStore.getState().toggleClusters()}
            >
              <span className="lbl">Toggle folder labels</span>
              <span className="path">G</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </Command>
    </>
  )
}
