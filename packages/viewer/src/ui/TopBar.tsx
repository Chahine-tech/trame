import { useState } from "react"
import { useGraphStore } from "../store/graph"
import { cycleThemePref, getThemePref } from "../theme"

const THEME_ICON = { auto: "◐", dark: "●", light: "○" } as const

export function TopBar({
  onOpenPalette,
  onOpenShortcuts,
}: {
  onOpenPalette: () => void
  onOpenShortcuts: () => void
}) {
  const data = useGraphStore((s) => s.data)
  const edgeFilter = useGraphStore((s) => s.edgeFilter)
  const impactOf = useGraphStore((s) => s.impactOf)
  const impactCount = useGraphStore((s) => s.impactDepth.size)
  const pathNodes = useGraphStore((s) => s.pathNodes)
  const isDemo = useGraphStore((s) => s.isDemo)
  const districtMode = useGraphStore((s) => s.districtMode)

  const healthy =
    (data?.violations?.length ?? 0) === 0 &&
    (data?.analysis?.cycles.length ?? 0) === 0 &&
    (data?.analysis?.orphans.length ?? 0) === 0
  const [theme, setTheme] = useState(getThemePref)

  const impactLabel = impactOf ? data?.nodes.find((n) => n.id === impactOf)?.label : null

  return (
    <header className="topbar">
      <span className="brand">
        trame<span className="d">_</span>
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
      {isDemo && (
        <span className="mode warn-chip" title="No trame.json was served — this is sample data">
          demo data
        </span>
      )}
      {data?.meta.error && (
        <span className="mode stale" title={data.meta.error}>
          stale · parse failed
        </span>
      )}
      {data && !data.diff && !impactLabel && pathNodes.length === 0 && (
        <span className="counts">
          {/* the project first, then how much of it you are looking at — a
              bare stat line says nothing about the thing itself. Skipped when
              it repeats the wordmark, as it does when trame parses itself. */}
          {data.meta.project !== "trame" && (
            <>
              <b className="project">{data.meta.project}</b>
              <span className="sep">·</span>
            </>
          )}
          {districtMode ? (
            <>
              <b>{data.clusters.length}</b> folders
            </>
          ) : (
            <>
              <b>{data.meta.nodeCount}</b> files in <b>{data.clusters.length}</b> folders
            </>
          )}
          {healthy ? (
            <span className="ok"> · ✓ no violations</span>
          ) : (
            <>
              {(data.violations?.length ?? 0) > 0 && (
                <span className="viol"> · ✗ {data.violations!.length} violations</span>
              )}
              {(data.analysis?.cycles.length ?? 0) > 0 && (
                <span className="warn"> · ↻ {data.analysis!.cycles.length} cycles</span>
              )}
              {(data.analysis?.orphans.length ?? 0) > 0 && (
                <span className="warn"> · ⌀ {data.analysis!.orphans.length} unused</span>
              )}
            </>
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
        onClick={onOpenShortcuts}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts"
      >
        ?
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
