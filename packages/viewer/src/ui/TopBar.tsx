import { useMemo, useState } from "react"
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
  const nearby = useGraphStore((s) => s.nearby)
  const whatIf = useGraphStore((s) => s.whatIf)
  const hotspots = useGraphStore((s) => s.hotspotHeat.size)

  const healthy =
    (data?.violations?.length ?? 0) === 0 &&
    (data?.analysis?.cycles.length ?? 0) === 0 &&
    (data?.analysis?.orphans.length ?? 0) === 0
  const [theme, setTheme] = useState(getThemePref)

  const impactLabel = impactOf ? data?.nodes.find((n) => n.id === impactOf)?.label : null

  /** How much of the repository is on screen; null when all of it is. */
  const shown = useMemo(() => {
    if (!data || !nearby || nearby.size >= data.meta.nodeCount) return null
    const folders = new Set<string>()
    for (const node of data.nodes) if (nearby.has(node.id)) folders.add(node.cluster)
    return { files: nearby.size, folders: folders.size }
  }, [data, nearby])

  return (
    <header className="topbar">
      <span className="brand">
        trame<span className="d">_</span>
      </span>
      {/* Where you are, before what you asked.
          The project used to render after the lens chips, which was fine while
          the two excluded each other; now that they sit side by side, turning a
          lens on slid the repository name four hundred pixels to the right. The
          one thing that does not depend on the question is the anchor. */}
      {data && !data.diff && (
        <span className="counts">
          {/* the project first, then how much of it you are looking at: a
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
          ) : shown ? (
            /* the detail view draws a neighbourhood, not the repository. Saying
               "2238 files" over 59 dots left people hunting for the rest. */
            <>
              <b>{shown.files}</b> of <b>{data.meta.nodeCount}</b> files in <b>{shown.folders}</b>{" "}
              folders
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
                /* "unused" claimed more than the analysis knows: nothing here
                   imports these, which is not the same as nobody running them */
                <span className="warn"> · ⌀ {data.analysis!.orphans.length} unimported</span>
              )}
            </>
          )}
          {edgeFilter && <span className="chip"> · edges: {edgeFilter}</span>}
        </span>
      )}
      {data?.diff && (
        <span className="mode diff">
          diff · <span className="add">+{data.diff.addedNodes}</span>{" "}
          <span className="del">−{data.diff.removedNodes}</span> nodes ·{" "}
          <span className="add">+{data.diff.addedEdges}</span>{" "}
          <span className="del">−{data.diff.removedEdges}</span> edges
        </span>
      )}
      {whatIf && (
        <span className="mode whatif">
          what if · delete {whatIf.label} →{" "}
          {whatIf.broken.length > 0 && <b>{whatIf.broken.length} break</b>}
          {whatIf.orphaned.length > 0 && (
            <>
              {whatIf.broken.length > 0 && " · "}
              <b>{whatIf.orphaned.length} stranded</b>
            </>
          )}
          {whatIf.cyclesResolved > 0 && (
            <span className="good"> · {whatIf.cyclesResolved} cycles resolved</span>
          )}
          {whatIf.broken.length === 0 &&
            whatIf.orphaned.length === 0 &&
            whatIf.cyclesResolved === 0 && <span className="good">nothing breaks</span>}
        </span>
      )}
      {hotspots > 0 && (
        /* the file count beside it says "433 of 3563 files in 4 folders",
           which is true of what is drawn and says nothing about what is being
           answered. Every other lens states its own finding here; this one
           states the size of the ranking and what tops it. */
        <span className="mode hotspots">
          hotspots · {hotspots} files ·{" "}
          {data?.hotspots?.[0]
            ? `${data.hotspots[0].churn} changes, ${data.hotspots[0].degree} dependants at the top`
            : ""}
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
