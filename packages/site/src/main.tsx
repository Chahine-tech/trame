import { createRoot } from "react-dom/client"
import { applyThemePref, getThemePref } from "@trame/viewer/theme"
import "@trame/viewer/scene.css"
import "./site.css"
import { Page } from "./Page"

applyThemePref(getThemePref())

/**
 * Always open at the top. The browser restores the previous scroll position on
 * reload, which drops a returning visitor mid-section, past the one arrival
 * cascade the page has to show.
 */
if ("scrollRestoration" in history) history.scrollRestoration = "manual"

createRoot(document.getElementById("root")!).render(<Page />)
