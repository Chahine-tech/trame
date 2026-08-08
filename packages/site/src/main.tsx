import { createRoot } from "react-dom/client"
import { applyThemePref, getThemePref } from "@trame/viewer/theme"
import "@trame/viewer/scene.css"
import "./site.css"
import { Hero } from "./Hero"

applyThemePref(getThemePref())

createRoot(document.getElementById("root")!).render(<Hero />)
