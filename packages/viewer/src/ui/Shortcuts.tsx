import { useEffect, useRef } from "react"

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
      { keys: ["O"], label: "Open the file in your editor" },
      { keys: ["⌘Z"], label: "Take back a deselection — file, lens and vantage" },
    ],
  },
  {
    // one at a time, on purpose: each repaints the whole graph to answer its
    // own question, and two answers at once mean neither is readable
    title: "lenses · one at a time",
    rows: [
      { keys: ["I"], label: "Impact — what depends on the selection" },
      { keys: ["W"], label: "What if — what deleting it would break" },
      { keys: ["shift", "click"], label: "Path — the chain between two nodes" },
      { keys: ["R"], label: "Replay — the architecture through git history" },
      { keys: ["esc"], label: "Drop the lens, keep the selection" },
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

/**
 * Always-available reference, the honest alternative to a guided tour.
 *
 * Native <dialog>: the platform supplies the modal semantics, focus trapping,
 * focus restore, top-layer stacking and ::backdrop that a role="dialog" div
 * would have to reimplement by hand.
 */
export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // keeps the close listener stable across the parent's inline callback
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  // Escape and any programmatic close both end here, so parent state follows
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleClose = () => onCloseRef.current()
    dialog.addEventListener("close", handleClose)
    return () => dialog.removeEventListener("close", handleClose)
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts"
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        // a backdrop click reports the dialog itself as target; compare against
        // its box so clicks on the panel's own padding don't dismiss it
        const dialog = dialogRef.current
        if (!dialog || e.target !== dialog) return
        const r = dialog.getBoundingClientRect()
        const inside =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        if (!inside) dialog.close()
      }}
    >
        <div className="shortcuts-head">
          <span>
            trame<span className="d">_</span> shortcuts
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
    </dialog>
  )
}
