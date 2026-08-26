import { useGraphStore } from "../store/graph"
import { blockedBecause, LENSES, type LensKind } from "../store/lens"
import { usePalette } from "../theme"

/**
 * The questions the graph can answer, and which one it is answering.
 *
 * `lens.ts` has carried the idea since the overlays stopped being independent
 * booleans, but none of it reached the screen: a reader found `I`, `W` and `R`
 * by opening the shortcut panel, and had no reason to suspect that turning one
 * on turns the others off. Four keys look like four features. A row of four
 * looks like one instrument with four settings.
 *
 * Quiet at rest, in the same language as the rest of the interface: colour
 * lands only on the lens that is currently answering.
 */
interface Entry {
  kind: Exclude<LensKind, "none" | "diff">
  /** how it is reached, which is not a key for every one of them */
  by: string
}

/**
 * `path` is a gesture, not a mode, so its chip states the gesture and does
 * nothing when pressed. Giving it a fake key would be worse than admitting it
 * works differently, and leaving it out would hide a quarter of the language.
 */
const ENTRIES: Entry[] = [
  { kind: "impact", by: "I" },
  { kind: "path", by: "⇧click" },
  { kind: "whatif", by: "W" },
  { kind: "replay", by: "R" },
]

export function LensBar() {
  const palette = usePalette()
  const lens = useGraphStore((s) => s.lens)
  const data = useGraphStore((s) => s.data)
  const selectedId = useGraphStore((s) => s.selectedId)
  const hasTimeline = useGraphStore((s) => s.timeline !== null)

  if (!data) return null

  const activate = (kind: Entry["kind"]) => {
    const s = useGraphStore.getState()
    if (kind === "impact") s.toggleImpact()
    else if (kind === "whatif") s.toggleWhatIf()
    else if (kind === "replay") (s.lens === "replay" ? s.exitReplay : s.enterReplay)()
  }

  return (
    <div className="lensbar" role="group" aria-label="Lenses">
      {ENTRIES.map(({ kind, by }) => {
        const info = LENSES[kind]
        const on = lens === kind
        const why = blockedBecause(kind, { selectedId, hasTimeline })
        const inert = kind === "path"
        return (
          <button
            key={kind}
            type="button"
            className={`lens-chip${on ? " on" : ""}${why ? " off" : ""}`}
            style={on ? { color: palette[info.accent], borderColor: palette[info.accent] } : undefined}
            // the gesture chip is a label: pressing it would promise a mode
            disabled={inert}
            aria-pressed={inert ? undefined : on}
            title={why ?? info.hint}
            onClick={() => !why && activate(kind)}
          >
            <span className="dot" style={{ background: on ? palette[info.accent] : "currentColor" }} />
            {info.label}
            {/* the key that entered is no use once you are inside; the way
                out is what a reader needs from a lit control */}
            <span className="by">{on ? "esc" : by}</span>
          </button>
        )
      })}
    </div>
  )
}
