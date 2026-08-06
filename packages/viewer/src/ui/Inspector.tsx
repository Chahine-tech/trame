import { useGraphStore } from "../store/graph"
import { NODE_COLOR, EDGE_COLOR, usePalette } from "../theme"

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

  const node = data?.nodes.find((n) => n.id === selectedId) ?? null
  const edge = data?.edges.find((e) => e.id === selectedEdgeId) ?? null
  const open = Boolean(node || edge)
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
          <div className="insp-path">
            {node.id}:{node.line}
          </div>
          <div className="insp-rows">
            <div className="insp-row">
              <span>Cluster</span>
              <b>{node.cluster}</b>
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
          {violations.length > 0 && (
            <div className="insp-violation">
              {violations.map((m, i) => (
                <div key={i}>✗ {m}</div>
              ))}
            </div>
          )}
          <div className="insp-hint">
            <span className="k">F</span> focus camera · <span className="k">esc</span> close
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
              {violations.map((m, i) => (
                <div key={i}>✗ {m}</div>
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
