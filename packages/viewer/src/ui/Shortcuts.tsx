interface Row {
  keys: string[]
  label: string
}

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "navigate",
    rows: [
      { keys: ["drag"], label: "Orbit the camera" },
      { keys: ["wheel"], label: "Zoom" },
      { keys: ["space"], label: "Reset camera" },
      { keys: ["F"], label: "Focus selection" },
      { keys: ["⌘K", "/"], label: "Command palette — search anything" },
    ],
  },
  {
    title: "inspect",
    rows: [
      { keys: ["hover"], label: "Light a node and its neighbours" },
      { keys: ["click"], label: "Select — opens the inspector" },
      { keys: ["I"], label: "Impact — everything that depends on it" },
      { keys: ["shift", "click"], label: "Trace the path between two nodes" },
      { keys: ["O"], label: "Open the file in your editor" },
    ],
  },
  {
    title: "shape",
    rows: [
      { keys: ["click", "edge"], label: "Reveal Bézier handles — drag to bend the curve" },
      { keys: ["dbl-click"], label: "Reset a curve · focus a node" },
      { keys: ["drag", "node"], label: "Move a node, edges follow" },
    ],
  },
  {
    title: "display",
    rows: [
      { keys: ["E"], label: "Cycle edge-type filter" },
      { keys: ["L"], label: "Toggle labels" },
      { keys: ["G"], label: "Toggle folder labels" },
      { keys: ["⌘E"], label: "Export PNG" },
      { keys: ["?"], label: "This panel · esc closes" },
    ],
  },
]

/** Always-available reference — the honest alternative to a guided tour. */
export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <>
      <div className="palette-overlay" onClick={onClose} />
      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <span>
            archviz<span className="d">_</span> shortcuts
          </span>
          <span className="esc">esc</span>
        </div>
        <div className="shortcuts-grid">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              {group.rows.map((row) => (
                <div className="sc-row" key={row.label}>
                  <span className="sc-keys">
                    {row.keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                  <span className="sc-label">{row.label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
