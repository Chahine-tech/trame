import { lazy, Suspense, useEffect, useState } from "react"
import type { GraphData } from "@trame/viewer/types"
import { Hero } from "./Hero"
import { SECTIONS } from "./sections"
import { useActiveSection } from "./useActiveSection"
import { useReplay } from "./useReplay"
import { HERO_POSE } from "./camera"
import { subjectOf, farthestFrom } from "./subject"

/**
 * The engine is code-split so the headline paints on its own, and requested
 * immediately so it does not queue behind anything.
 *
 * Three.js is ~300 kB gzip whatever we do; blocking the first paint on it
 * would mean a second of empty page for someone arriving from a link — the
 * worst possible first impression for a page that promises something visual.
 *
 * The import starts here, at module scope, rather than being left to `lazy` to
 * trigger on first render. Render is gated on the graph having arrived, so
 * leaving it to `lazy` put 1.1 MB of renderer *behind* a 16 kB fetch that has
 * nothing to do with it. Started here the two race instead of queueing, and
 * the browser still paints the copy while the chunk lands.
 */
const enginePromise = import("./Stage")
const Stage = lazy(() => enginePromise.then((m) => ({ default: m.Stage })))

/**
 * One canvas, pinned, with the whole page scrolling over it.
 *
 * The graph is never rebuilt, never crossfaded, never swapped for a screenshot:
 * it is the same running instance from the first pixel to the last section, and
 * scrolling only changes which question is being asked of it. That is the whole
 * argument of the page — you are not reading about the tool, you are watching
 * it work — and it only holds if the thing on screen never resets.
 *
 * Scroll is a clock, not a hijack. The page scrolls at its natural speed, a
 * flick to the bottom lands at the bottom, and nothing waits for an animation
 * to finish before letting you move.
 */
export function Page() {
  const [data, setData] = useState<GraphData | null>(null)
  const { active, register } = useActiveSection(SECTIONS.length)

  /**
   * The data is fetched here, in the light chunk, not inside the engine.
   *
   * It used to live in Stage — which meant 16 kB of graph queued behind
   * 300 kB of renderer for no reason. Preloaded from the HTML and read here,
   * it arrives long before the engine.
   */
  useEffect(() => {
    const controller = new AbortController()
    fetch("/demo.json", { signal: controller.signal })
      .then((r) => r.json() as Promise<GraphData>)
      .then(setData)
      .catch(() => {
        /* the copy stands on its own */
      })
    return () => controller.abort()
  }, [])

  /**
   * Put the graph in the active section's state.
   *
   * Every section calls the same store actions a visitor's keystroke would, so
   * the page cannot show a behaviour the tool does not have. The subject is
   * derived from the graph rather than hard-coded, so this survives a change of
   * demo codebase.
   */
  const replayIndex = SECTIONS.findIndex((s) => s.lens === "replay")
  // armed one section early so 222 kB has landed before the visitor arrives
  useReplay(active === replayIndex, active >= replayIndex - 1)

  useEffect(() => {
    if (!data || active < 0) return
    const subject = subjectOf()
    if (!subject) return
    SECTIONS[active]?.enter(subject.id, farthestFrom(subject.id)?.id ?? null)
  }, [active, data])

  const pose = active < 0 ? HERO_POSE : (SECTIONS[active] ?? { distance: HERO_POSE.distance, height: HERO_POSE.height })

  return (
    <main className="page">
      {data && (
        <Suspense fallback={null}>
          <Stage data={data} pose={pose} scripted={active < 0} />
        </Suspense>
      )}

      <Hero />

      {SECTIONS.map((section, i) => (
        <section
          key={section.id}
          ref={register(i)}
          className={`beat${active === i ? " on" : ""}`}
          data-lens={section.lens ?? "none"}
          aria-labelledby={`${section.id}-title`}
        >
          <div className="beat-copy">
            <span className="eyebrow">{section.eyebrow}</span>
            <h2 id={`${section.id}-title`}>{section.title}</h2>
            <p>{section.body}</p>
          </div>
        </section>
      ))}
    </main>
  )
}
