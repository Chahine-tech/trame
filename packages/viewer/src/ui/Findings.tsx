import { useMemo } from "react"
import { useGraphStore } from "../store/graph"
import { usePalette } from "../theme"

/**
 * What the tool found, as a list you can walk.
 *
 * `diagnose` has run on every load since the doctor shipped, and its result was
 * used to pick one node to open on and then dropped — on dub, 143 ranked
 * findings, each carrying a sentence saying what to do about it, none of which
 * ever reached the screen. The counts were already in the top bar, sitting over
 * them as dead text.
 *
 * Not a lens: it repaints nothing and adds no colour to learn. It is a table of
 * contents. Selecting a row hands the reader to `select` and `focus`, the
 * machinery that already exists for going somewhere.
 */
const HEADING: Record<string, { title: string; lede: string }> = {
  cycle: {
    title: "files that depend on each other in a loop",
    lede: "Each one names the single import that frees the most, verified by removing it and recounting.",
  },
  violation: {
    title: "rules this codebase breaks",
    lede: "From the rules in trame.config.ts, ranked by how many files each one involves.",
  },
  orphan: {
    title: "files nothing imports",
    lede: "An inference, not a verdict: a dynamic import is invisible, so this says what would go with a deletion rather than telling you to delete.",
  },
}

export function Findings() {
  const palette = usePalette()
  const kind = useGraphStore((s) => s.browsing)
  const findings = useGraphStore((s) => s.findings)
  const selectedId = useGraphStore((s) => s.selectedId)
  const go = useGraphStore((s) => s.goToFinding)
  const browse = useGraphStore((s) => s.browse)

  const rows = useMemo(
    () => (kind ? findings.filter((f) => f.kind === kind) : []),
    [findings, kind],
  )

  if (!kind || rows.length === 0) return null
  const head = HEADING[kind]

  return (
    <aside className="inspector open findings-rail" aria-label="Findings">
      <div className="insp-eyebrow" style={{ color: palette.yellow }}>
        <span
          className="sw"
          style={{ background: palette.yellow, boxShadow: `0 0 10px ${palette.yellow}` }}
        />
        {kind === "cycle" ? "cycles" : kind === "violation" ? "violations" : "unimported"}
      </div>
      <div className="insp-title">
        {rows.length} {head?.title}
      </div>
      <p className="hot-lede">{head?.lede}</p>
      <ol className="find-list">
        {rows.map((f) => {
          const on = f.nodeIds.includes(selectedId ?? "")
          return (
            <li key={`${f.kind}-${f.title}`}>
              <button
                type="button"
                className={`find-row${on ? " on" : ""}`}
                onClick={() => go(f)}
                aria-current={on || undefined}
              >
                <span className="find-title">{f.title}</span>
                {/* the sentence doctor already writes, and the reason this list
                    is worth reading rather than counting */}
                <span className="find-fix">{f.fix}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="insp-hint">
        <span className="k">click</span> one to go where it is
        <br />
        <button type="button" className="find-close" onClick={() => browse(null)}>
          close
        </button>{" "}
        or press <span className="k">esc</span>
      </div>
    </aside>
  )
}
