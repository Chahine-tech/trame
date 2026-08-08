import { lazy, Suspense, useEffect, useState } from "react"
import { cycleThemePref, getThemePref } from "@trame/viewer/theme"
import type { GraphData } from "@trame/viewer/types"

const THEME_ICON = { auto: "◐", dark: "●", light: "○" } as const

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
const enginePromise = import("./HeroCanvas")
const HeroCanvas = lazy(() => enginePromise.then((m) => ({ default: m.HeroCanvas })))

export function Hero() {
  const [data, setData] = useState<GraphData | null>(null)
  const [theme, setTheme] = useState(getThemePref)

  /**
   * The data is fetched here, in the light chunk, not inside the engine.
   *
   * It used to live in HeroCanvas — which meant 16 kB of graph queued behind
   * 300 kB of renderer for no reason. Preloaded from the HTML and read here,
   * it arrives long before the engine and can already be drawn flat.
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

  return (
    <section className="hero">
      {/* The product ships two deliberate visual worlds — a lit space and an
          inked plate — and the landing is the product, so it offers both. */}
      <button
        className="theme-toggle"
        onClick={() => setTheme(cycleThemePref())}
        aria-label={`Theme: ${theme}`}
      >
        {THEME_ICON[theme]} {theme}
      </button>

      {data && (
        <Suspense fallback={null}>
          <HeroCanvas data={data} />
        </Suspense>
      )}

      <div className="hero-copy">
        <span className="wordmark">
          trame<span className="cursor">_</span>
        </span>

        <h1>
          Google Maps for your
          <br />
          frontend architecture.
        </h1>

        <p>
          Parse any TypeScript codebase and explore it as an interactive 3D map. See what
          breaks before you touch it, trace how two files got connected, and fail CI when
          the architecture drifts.
        </p>

        <div className="hero-actions">
          <a className="cta primary" href="/demo">
            Explore a real codebase
          </a>
          <a className="cta" href="https://github.com/Chahine-tech/trame">
            GitHub
          </a>
        </div>

        <p className="hero-hint">This is the tool itself, running. Drag to take the camera.</p>
      </div>
    </section>
  )
}
