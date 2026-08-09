import { useState } from "react"
import { cycleThemePref, getThemePref } from "@trame/viewer/theme"

const THEME_ICON = { auto: "◐", dark: "●", light: "○" } as const

const REPO = "https://github.com/Chahine-tech/trame"

/**
 * Where the tool lives. It is a separate application with its own deployment,
 * so this is the one place that knows about it.
 *
 * Set VITE_VIEWER_URL at build time to the hosted viewer's URL. The fallbacks
 * differ by environment on purpose: locally it points at the port the viewer's
 * dev server uses, so the link works with nothing configured — but shipping
 * that same localhost URL to production would put a dead link on the page's
 * primary call to action, silently, on every visitor's machine but the
 * author's. Unset in a production build, it sends people somewhere real.
 */
const DEMO_URL =
  import.meta.env.VITE_VIEWER_URL ?? (import.meta.env.DEV ? "http://localhost:5173/" : REPO)

/**
 * The first screen: the promise, and the graph proving it behind.
 *
 * It owns no canvas of its own — the page pins one behind every section, so
 * scrolling never restarts the graph. This is only the copy.
 */
export function Hero() {
  const [theme, setTheme] = useState(getThemePref)

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
          <a className="cta primary" href={DEMO_URL}>
            Explore a real codebase
          </a>
          <a className="cta" href={REPO}>
            GitHub
          </a>
        </div>

        {/* The strongest claim on the page, and it costs a sentence.
         *
         * The graph is not a mock-up: every one of its nodes is a real file in
         * packages/viewer/src, parsed by the real parser. NodeMesh and EdgeMesh
         * are in there — so the code drawing this graph is part of what it
         * draws. "This is the tool itself, running" said the same thing and
         * asked to be taken on trust; this version can be checked by clicking
         * a node. */}
        <p className="hero-hint">
          <span className="live">live</span>
          trame parsed its own source — the files drawing this graph are in it. Scroll
          to see it answer questions.
        </p>
      </div>
    </section>
  )
}
