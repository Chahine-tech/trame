import { useState } from "react"
import { useGraphStore } from "../store/graph"
import { cycleThemePref, getThemePref } from "../theme"

const THEME_ICON = { auto: "◐", dark: "●", light: "○" } as const

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const data = useGraphStore((s) => s.data)
  const edgeFilter = useGraphStore((s) => s.edgeFilter)
  const [theme, setTheme] = useState(getThemePref)

  return (
    <header className="topbar">
      <span className="brand">
        archviz<span className="d">_</span>
      </span>
      {data && (
        <span className="counts">
          <b>{data.meta.nodeCount}</b> nodes · <b>{data.meta.edgeCount}</b> edges ·{" "}
          <b>{data.clusters.length}</b> folders
          {(data.violations?.length ?? 0) > 0 && (
            <span className="viol"> · ✗ {data.violations!.length} violations</span>
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
