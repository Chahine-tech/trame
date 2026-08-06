import { useGraphStore } from "../store/graph"

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const data = useGraphStore((s) => s.data)

  return (
    <header className="topbar">
      <span className="brand">
        archviz<span className="d">_</span>
      </span>
      {data && (
        <span className="counts">
          <b>{data.meta.nodeCount}</b> nodes · <b>{data.meta.edgeCount}</b> edges ·{" "}
          <b>{data.clusters.length}</b> clusters
        </span>
      )}
      <button className="kbd" onClick={onOpenPalette} aria-label="Open command palette">
        ⌘K
      </button>
    </header>
  )
}
