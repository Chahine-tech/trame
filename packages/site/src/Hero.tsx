import { useState } from "react"
import { cycleThemePref, getThemePref } from "@trame/viewer/theme"
import { DEMO_URL, REPO } from "./viewer-url"

const THEME_ICON = { auto: "◐", dark: "●", light: "○" } as const

/** Copy only. The page pins one canvas behind every section. */
export function Hero() {
  const [theme, setTheme] = useState(getThemePref)

  return (
    <section className="hero">
      {/* the viewer ships both grounds, so the landing offers both */}
      <button
        className="theme-toggle"
        onClick={() => setTheme(cycleThemePref())}
        aria-label={`Theme: ${theme}`}
      >
        {THEME_ICON[theme]} {theme}
      </button>

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
          Parse any TypeScript codebase and explore it as an interactive 3D map. See what breaks
          before you touch it, trace how two files got connected, and fail CI when the architecture
          drifts.
        </p>

        <div className="hero-actions">
          <a className="cta primary" href={DEMO_URL}>
            Explore a real codebase
          </a>
          <a className="cta" href={REPO}>
            GitHub
          </a>
        </div>

        {/* Every node is a real file in packages/viewer/src, NodeMesh and
            EdgeMesh included. The earlier wording, "this is the tool itself,
            running", asked to be taken on trust; this one can be checked by
            clicking a node. */}
        <p className="hero-hint">
          <span className="live">live</span>
          trame parsed its own source — the files drawing this graph are in it. Scroll to see it
          answer questions.
        </p>
      </div>
    </section>
  )
}
