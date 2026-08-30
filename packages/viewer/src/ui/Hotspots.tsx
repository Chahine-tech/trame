import { useMemo } from "react"
import { useGraphStore } from "../store/graph"
import { disambiguate } from "../scene/names"
import { hotspotReading } from "../store/reading"
import { usePalette } from "../theme"

/**
 * The ranking, as a list.
 *
 * A hotspot lens is the only question here that is asked of the whole
 * repository rather than of a file, and a global ranking does not survive being
 * drawn as node colour: measured on dub, its 151 files span the graph, so the
 * camera stands 824 units off and every one of them is a dot two pixels
 * across — where the first and the last differ by 1.27x of contrast. The map
 * can say *where* the pressure is. It cannot say *how much*, and it certainly
 * cannot rank.
 *
 * So the rail carries the order and the map carries the places. The inspector
 * stands down while this is up, because a panel describing whatever file was
 * selected a question ago is the largest stale surface on the screen.
 */
export function Hotspots() {
  const palette = usePalette()
  const data = useGraphStore((s) => s.data)
  const heat = useGraphStore((s) => s.hotspotHeat)
  const knot = useGraphStore((s) => s.hotspotKnot)
  const selectedId = useGraphStore((s) => s.selectedId)
  const nodes = useGraphStore((s) => s.data?.nodes)
  const pick = useGraphStore((s) => s.pickHotspot)

  /**
   * What the cut turned out to be, read off the result rather than shipped.
   *
   * The parser cuts at the ninetieth percentile of this graph's own two
   * distributions, and those thresholds are the interesting part of the claim —
   * "11 changes and 12 dependants" is what makes 151 files a finding instead of
   * a number. Recovering them from the list keeps the graph format free of a
   * field that would only ever restate it.
   *
   * Keyed on the graph's own array, not on a `?? []` fallback: that fallback is
   * a new array on every render, so the memo recomputed on every render and was
   * one only in name.
   */
  const ranked = data?.hotspots
  const cut = useMemo(() => {
    if (!ranked?.length) return null
    return {
      churn: Math.min(...ranked.map((h) => h.churn)),
      degree: Math.min(...ranked.map((h) => h.degree)),
    }
  }, [ranked])
  const rows = ranked ?? []
  /**
   * Qualified against the ranking, not against what the scene draws.
   *
   * The store's `names` describes whoever shares the screen, and this lens no
   * longer puts anything on it — so every row fell back to its full path and
   * the list became a column of truncated directories. The set worth telling
   * apart is the hundred and fifty in the list.
   */
  const reading = useMemo(() => (data ? hotspotReading(data) : []), [data])
  const names = useMemo(() => {
    // keyed on the graph's own array, not on the `?? []` fallback, which is a
    // fresh one on every render — the same trap this file already fell into
    const inRanking = new Set((ranked ?? []).map((h) => h.id))
    return disambiguate((nodes ?? []).filter((n) => inRanking.has(n.id)))
  }, [ranked, nodes])

  if (heat.size === 0 || rows.length === 0) return null

  return (
    <aside className="inspector open hotspot-rail" aria-label="Hotspots">
      <div className="insp-eyebrow" style={{ color: palette.red }}>
        <span
          className="sw"
          style={{ background: palette.red, boxShadow: `0 0 10px ${palette.red}` }}
        />
        hotspots
      </div>
      {/* The title says the finding, not the size of the cut.
          "150 of 3562 files" is a percentile: a p90 cut on two distributions
          returns about a tenth of the files whatever the repository looks like,
          so the number was a property of the cut and said nothing. What is a
          finding is how many of them cannot be changed on their own. */}
      <div className="insp-title">
        {knot.size > 0 ? `${knot.size} caught in a cycle` : `${rows.length} under pressure`}
      </div>
      {cut && (
        /* not `insp-path`: that class breaks anywhere, which is right for a
           file path and wrong for a sentence — it split "dependants" across
           two lines */
        <div className="hot-cut">
          of {rows.length} files changed {cut.churn}+ times · {cut.degree}+ dependants
        </div>
      )}
      {/* What was found, not what a hotspot is.
          This was a definition — "often rewritten, and much rests on them" —
          true of the feature and silent about the repository in front of you.
          Every sentence here is computed, carries a figure this graph produced,
          and is dropped when the graph does not support it: on dub the third
          claim stays quiet, because the top of the ranking is neither the
          most-changed file nor the most depended-on. */}
      {reading.map((line) => (
        <p className="hot-lede" key={line}>
          {line}
        </p>
      ))}
      <ol className="hot-list">
        {rows.map((h, i) => {
          const on = h.id === selectedId
          return (
            <li key={h.id}>
              <button
                type="button"
                className={`hot-row${on ? " on" : ""}${knot.has(h.id) ? " knotted" : ""}`}
                onClick={() => pick(h.id)}
                title={h.id}
                aria-current={on || undefined}
              >
                {/* the rank is a number and stays one; being in the knot is a
                    fact and gets a mark, the same red the map uses */}
                <span className="hot-rank">{i + 1}</span>
                {/* the same disambiguated name the map writes, so a row and its
                    dot are recognisably the same file */}
                <span className="hot-name">{names.get(h.id) ?? h.id}</span>
                <span className="hot-counts">
                  <b>{h.churn}</b>×<b>{h.degree}</b>
                </span>
                {/* The same measure the map draws the radius from, so the list
                    and the picture are one statement — and it answers "where
                    does the top of this end" without anyone inventing a cut.
                    It ran across a 20px column first, where the first row and
                    the fifteenth came out 20px and 9px: four pixels of
                    difference on a three-hundred-pixel row, which is no gauge
                    at all. It needs the width of the panel, so it takes its own
                    line under the name. */}
                <span className="hot-bar" aria-hidden>
                  <i style={{ width: `${Math.max((heat.get(h.id) ?? 0) * 100, 2)}%` }} />
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="insp-hint">
        <span className="k">click</span> a row to aim the camera at it
        <br />
        <span className="k">esc</span> leaves the lens with that file selected
      </div>
    </aside>
  )
}
