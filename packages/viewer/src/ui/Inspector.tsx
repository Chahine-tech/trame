import { useGraphStore } from "../store/graph"
import { NODE_COLOR, EDGE_COLOR, usePalette } from "../theme"
import { EDITOR_LABEL, getEditor, locate, openInEditor } from "../editor"

export function Inspector() {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const selectedId = useGraphStore((s) => s.selectedId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const inDeg = useGraphStore((s) => s.inDeg)
  const outDeg = useGraphStore((s) => s.outDeg)
  const adjacency = useGraphStore((s) => s.adjacency)

  const violatedNodes = useGraphStore((s) => s.violatedNodes)
  const violatedEdges = useGraphStore((s) => s.violatedEdges)

  const orphans = useGraphStore((s) => s.orphans)

  const node = data?.nodes.find((n) => n.id === selectedId) ?? null
  const here = locate(node?.file, data?.meta.root)
  const edge = data?.edges.find((e) => e.id === selectedEdgeId) ?? null
  const open = Boolean(node || edge)
  const isOrphan = node ? orphans.has(node.id) : false
  const violations = node
    ? (violatedNodes.get(node.id) ?? [])
    : edge
      ? (violatedEdges.get(edge.id) ?? [])
      : []

  // keep last content while sliding out — the panel exits the way it entered
  return (
    <aside className={`inspector${open ? " open" : ""}`} aria-hidden={!open}>
      {node && (
        <>
          <div className="insp-eyebrow" style={{ color: palette[NODE_COLOR[node.type]] }}>
            <span
              className="sw"
              style={{
                background: palette[NODE_COLOR[node.type]],
                boxShadow: `0 0 10px ${palette[NODE_COLOR[node.type]]}`,
              }}
            />
            {node.type}
          </div>
          <div className="insp-title">{node.label}</div>
          <button
            className="insp-path insp-path-link"
            onClick={() => here && openInEditor(here, node.line)}
            title={
              here
                ? `Open in ${EDITOR_LABEL[getEditor()]} — ${node.id}:${node.line}`
                : // somebody else's codebase: the file is real, just not here
                  `${node.id}:${node.line} — not on this machine`
            }
            disabled={!here}
          >
            {node.id}:{node.line}
            <span className="go">↗</span>
          </button>
          <div className="insp-rows">
            <div className="insp-row">
              <span>Folder</span>
              <b className="folder-chip">
                <span
                  className="dot"
                  style={{
                    background: data?.clusters.find((c) => c.id === node.cluster)?.color,
                  }}
                />
                {node.cluster}/
              </b>
            </div>
            <div className="insp-row">
              <span>Imports</span>
              <b>{outDeg.get(node.id) ?? 0}</b>
            </div>
            <div className="insp-row">
              <span>Used by</span>
              <b>{inDeg.get(node.id) ?? 0}</b>
            </div>
            <div className="insp-row">
              <span>Neighbors</span>
              <b>{adjacency.get(node.id)?.size ?? 0}</b>
            </div>
          </div>
          {isOrphan && (
            <div className="insp-warning">
              ⌀ Nothing imports this — possible dead code
            </div>
          )}
          {violations.length > 0 && (
            <div className="insp-violation">
              {violations.map((m) => (
                <div key={m}>✗ {m}</div>
              ))}
            </div>
          )}
          <div className="insp-hint">
            <span className="k">O</span> open in editor · <span className="k">I</span> impact ·{" "}
            <span className="k">F</span> focus
            <br />
            <span className="k">shift-click</span> another node to trace the path
          </div>
        </>
      )}
      {edge && (
        <>
          <div className="insp-eyebrow" style={{ color: palette[EDGE_COLOR[edge.type]] }}>
            <span
              className="sw"
              style={{
                background: palette[EDGE_COLOR[edge.type]],
                boxShadow: `0 0 10px ${palette[EDGE_COLOR[edge.type]]}`,
              }}
            />
            edge · {edge.type}
          </div>
          <div className="insp-title">
            {data?.nodes.find((n) => n.id === edge.source)?.label}
            {" → "}
            {data?.nodes.find((n) => n.id === edge.target)?.label}
          </div>
          <div className="insp-path">{edge.id}</div>
          {violations.length > 0 && (
            <div className="insp-violation">
              {violations.map((m) => (
                <div key={m}>✗ {m}</div>
              ))}
            </div>
          )}
          <div className="insp-hint">
            <span className="k">drag</span> the lavender handles to reshape the curve
            <br />
            <span className="k">double-click</span> reset · <span className="k">esc</span> close
          </div>
        </>
      )}
    </aside>
  )
}
