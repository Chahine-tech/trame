import { createRoot } from "react-dom/client"
import { applyThemePref, getThemePref } from "@trame/viewer/theme"
import "@trame/viewer/scene.css"
import "./site.css"
import { Page } from "./Page"

applyThemePref(getThemePref())

/**
 * Always open at the top.
 *
 * The browser restores the previous scroll position on reload, which for an
 * ordinary document is right — you were reading something. Here the first
 * screen is an opening statement whose graph assembles itself once, and being
 * dropped mid-section shows a heading sliced by the viewport edge instead.
 */
if ("scrollRestoration" in history) history.scrollRestoration = "manual"


createRoot(document.getElementById("root")!).render(<Page />)
