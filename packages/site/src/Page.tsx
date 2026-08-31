import { lazy, Suspense, useEffect, useState } from "react"
import type { GraphData } from "@trame/viewer/types"
import { useGraphStore } from "@trame/viewer/store/graph"
import { Hero } from "./Hero"
import { SECTIONS } from "./sections"
import { useActiveSection } from "./useActiveSection"
import { useReplay } from "./useReplay"
import { HERO_POSE } from "./camera"
import { subjectOf, farthestFrom } from "./subject"
import { SceneBoundary } from "./SceneBoundary"

/**
 * Started at module scope, not left to `lazy`.
 *
 * Render is gated on the graph having arrived, so `lazy` would fire the import
 * only after the fetch resolved: 1.1 MB of renderer queued behind a 16 kB
 * fetch. Started here the two run in parallel.
 */
const enginePromise = import("./Stage")
const Stage = lazy(() => enginePromise.then((m) => ({ default: m.Stage })))

export function Page() {
  const [data, setData] = useState<GraphData | null>(null)
  // the same knot the viewer's panel reads, so a beat cannot offer a hand-off
  // on a graph that does have a finding of its own
  const knot = useGraphStore((s) => s.hotspotKnot)
  const { active, register } = useActiveSection(SECTIONS.length)

  // fetched in the light chunk. In Stage it sat behind 300 kB of renderer.
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

  // sections drive the store through the same actions a keystroke would, and
  // the subject is derived from the graph so a change of demo codebase holds
  const replayIndex = SECTIONS.findIndex((s) => s.lens === "replay")
  // armed one section early so 222 kB has landed before the visitor arrives
  useReplay(active === replayIndex, active >= replayIndex - 1)

  useEffect(() => {
    if (!data || active < 0) return
    const subject = subjectOf()
    if (!subject) return
    SECTIONS[active]?.enter(subject.id, farthestFrom(subject.id)?.id ?? null)
  }, [active, data])

  const pose =
    active < 0
      ? HERO_POSE
      : (SECTIONS[active] ?? { distance: HERO_POSE.distance, height: HERO_POSE.height })

  return (
    <main className="page">
      {data && (
        <SceneBoundary>
          <Suspense fallback={null}>
            <Stage data={data} pose={pose} scripted={active < 0} />
          </Suspense>
        </SceneBoundary>
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
            {/* only when this beat's finding really is absent here: the store
                holds the same knot the viewer's panel reads */}
            {section.handoff && knot.size === 0 && (
              <p className="handoff">
                {section.handoff.text}{" "}
                <a href={section.handoff.href}>See it on a codebase that has one →</a>
              </p>
            )}
          </div>
        </section>
      ))}
    </main>
  )
}
