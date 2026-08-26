import { Command } from "cmdk"
import { toDot, toMermaid } from "tramejs/export"
import { currentGraph, exportGraph, useGraphStore } from "../store/graph"
import { NODE_COLOR, usePalette } from "../theme"
import { shareUrl } from "../share"
import { EDITORS, EDITOR_LABEL, getEditor, locate, openInEditor, setEditor } from "../editor"
import type { GraphData } from "../types"
import {
  toastCopied,
  toastCopyFailed,
  toastEditorSwitched,
  toastNoReplay,
  toastExported,
  toastOpeningEditor,
} from "./toast"

/**
 * Clipboard, not download: these go straight into a PR body or a README.
 * Reads the store directly, so it belongs at module scope rather than being
 * rebuilt on every render.
 */
async function copyDiagram(label: string, serialize: (g: GraphData) => string): Promise<void> {
  const graph = currentGraph()
  if (!graph) return
  // the filter you are looking at is the diagram you meant to share
  const filter = useGraphStore.getState().edgeFilter
  const scoped = filter ? { ...graph, edges: graph.edges.filter((e) => e.type === filter) } : graph
  // a replay frame is history: name it, or it gets pasted as the present
  const s = useGraphStore.getState()
  const frame = s.lens === "replay" ? s.timeline?.frames[s.frameIndex] : undefined
  const state = frame ? `${frame.sha} · ${new Date(frame.date).toLocaleDateString()}` : undefined

  try {
    await navigator.clipboard.writeText(serialize(scoped))
    toastCopied(label, state)
  } catch {
    toastCopyFailed(label)
  }
}

/**
 * ⌘K command palette. Opened 100+ times a day → zero animation, ever
 * (frequency rule; Raycast has no open/close animation either).
 */
export function Palette({
  open,
  onClose,
  onShowShortcuts,
}: {
  open: boolean
  onClose: () => void
  onShowShortcuts: () => void
}) {
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
    a.download = "trame.json"
    a.click()
    URL.revokeObjectURL(url)
    onClose()
    toastExported("trame.json")
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
              value="open in editor file source"
              onSelect={() => {
                const s = useGraphStore.getState()
                const node = s.data?.nodes.find((n) => n.id === s.selectedId)
                onClose()
                const here = locate(node?.file, s.data?.meta.root)
                if (here && node) {
                  openInEditor(here, node.line)
                  toastOpeningEditor(EDITOR_LABEL[getEditor()], `${node.id}:${node.line}`)
                }
              }}
            >
              <span className="lbl">Open selection in {EDITOR_LABEL[getEditor()]}</span>
              <span className="path">O</span>
            </Command.Item>
            <Command.Item
              value="share link url copy view"
              onSelect={() => {
                onClose()
                const url = shareUrl()
                navigator.clipboard
                  .writeText(url)
                  .then(() => toastCopied("Link to this view"))
                  .catch(() => toastCopyFailed("link"))
              }}
            >
              <span className="lbl">Copy link to this view</span>
              <span className="path">selection + lens</span>
            </Command.Item>
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
              <span className="lbl">Export trame.json (curves included)</span>
            </Command.Item>
            <Command.Item
              value="copy mermaid diagram markdown github"
              onSelect={() => {
                onClose()
                copyDiagram("Mermaid", (g) => toMermaid(g))
              }}
            >
              <span className="lbl">Copy as Mermaid</span>
              <span className="path">paste in a PR</span>
            </Command.Item>
            <Command.Item
              value="copy dot graphviz"
              onSelect={() => {
                onClose()
                copyDiagram("DOT", (g) => toDot(g))
              }}
            >
              <span className="lbl">Copy as Graphviz DOT</span>
            </Command.Item>
            <Command.Item
              value="impact analysis blast radius dependents"
              onSelect={() => {
                onClose()
                useGraphStore.getState().toggleImpact()
              }}
            >
              <span className="lbl">Impact of selection</span>
              <span className="path">I</span>
            </Command.Item>
            <Command.Item
              value="replay history git evolution timeline"
              onSelect={() => {
                onClose()
                const s = useGraphStore.getState()
                if (s.lens === "replay") s.exitReplay()
                else if (s.timeline) s.enterReplay()
                else toastNoReplay()
              }}
            >
              <span className="lbl">Replay the architecture through git history</span>
              <span className="path">R</span>
            </Command.Item>
            <Command.Item
              value="what if delete simulate consequences"
              onSelect={() => {
                onClose()
                useGraphStore.getState().toggleWhatIf()
              }}
            >
              <span className="lbl">What if I deleted the selection?</span>
              <span className="path">W</span>
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
            <Command.Item value="show keyboard shortcuts help" onSelect={onShowShortcuts}>
              <span className="lbl">Show keyboard shortcuts</span>
              <span className="path">?</span>
            </Command.Item>
          </Command.Group>
          <Command.Group heading="editor">
            {EDITORS.map((scheme) => {
              const active = scheme === getEditor()
              return (
                <Command.Item
                  key={scheme}
                  value={`set editor ${scheme} ${EDITOR_LABEL[scheme]}`}
                  onSelect={() => {
                    setEditor(scheme)
                    toastEditorSwitched(EDITOR_LABEL[scheme])
                    onClose()
                  }}
                >
                  <span
                    className="g"
                    style={{ background: active ? palette.lav : "transparent" }}
                  />
                  <span className="lbl">{EDITOR_LABEL[scheme]}</span>
                  {active && <span className="path">current</span>}
                </Command.Item>
              )
            })}
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
