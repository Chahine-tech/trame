import { useState } from "react"
import { useGraphStore } from "../store/graph"
import { cycleThemePref, getThemePref } from "../theme"

const THEME_ICON = { auto: "◐", dark: "●", light: "○" } as const

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const data = useGraphStore((s) => s.data)
  const edgeFilter = useGraphStore((s) => s.edgeFilter)
  const impactOf = useGraphStore((s) => s.impactOf)
  const impactCount = useGraphStore((s) => s.impactDepth.size)
  const pathNodes = useGraphStore((s) => s.pathNodes)
  const [theme, setTheme] = useState(getThemePref)

  const impactLabel = impactOf ? data?.nodes.find((n) => n.id === impactOf)?.label : null

  return (
    <header className="topbar">
      <span className="brand">
        archviz<span className="d">_</span>
      </span>
      {data?.diff && (
        <span className="mode diff">
          diff · <span className="add">+{data.diff.addedNodes}</span>{" "}
          <span className="del">−{data.diff.removedNodes}</span> nodes ·{" "}
          <span className="add">+{data.diff.addedEdges}</span>{" "}
          <span className="del">−{data.diff.removedEdges}</span> edges
        </span>
      )}
      {impactLabel && (
        <span className="mode impact">
          impact · {impactLabel} → {impactCount - 1} dependents
        </span>
      )}
      {pathNodes.length > 0 && <span className="mode path">path · {pathNodes.length} hops</span>}
      {data && !data.diff && !impactLabel && pathNodes.length === 0 && (
        <span className="counts">
          <b>{data.meta.nodeCount}</b> nodes · <b>{data.meta.edgeCount}</b> edges ·{" "}
          <b>{data.clusters.length}</b> folders
          {(data.violations?.length ?? 0) > 0 && (
            <span className="viol"> · ✗ {data.violations!.length} violations</span>
          )}
          {(data.analysis?.orphans.length ?? 0) > 0 && (
            <span className="warn"> · ⌀ {data.analysis!.orphans.length} orphans</span>
          )}
          {(data.analysis?.cycles.length ?? 0) > 0 && (
            <span className="warn"> · ↻ {data.analysis!.cycles.length} cycles</span>
          )}
          {edgeFilter && <span className="chip"> · edges: {edgeFilter}</span>}
        </span>
      )}
      <button
        className="kbd"
        style={{ marginLeft: "auto" }}
        onClick={() => setTheme(cycleThemePref())}
        aria-label={`Theme: ${theme}`}
        title={`Theme: ${theme}`}
      >
        {THEME_ICON[theme]} {theme}
      </button>
      <button
        className="kbd"
        style={{ marginLeft: 0 }}
        onClick={onOpenPalette}
        aria-label="Open command palette"
      >
        ⌘K
      </button>
    </header>
  )
}
