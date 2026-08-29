import { useGraphStore } from "@trame/viewer/store/graph"
import { coChangeSubjectOf } from "./subject"

/**
 * One entry per beat of the page.
 *
 * Each section drives the store through the same actions a keystroke would, so
 * the landing cannot show a behaviour the viewer does not have. Sections decide
 * what is shown while they hold the viewport, never how fast you scroll.
 */
export interface Section {
  id: string
  /**
   * Which lens this section turns on, or null when it turns them all off.
   * Named rather than inferred from `enter`, because the eyebrow is drawn in
   * that lens' colour.
   */
  lens: "impact" | "path" | "whatif" | "cochange" | "hotspots" | "replay" | null
  /** small label above the title */
  eyebrow: string
  title: string
  body: string
  /** orbit radius while this section holds the viewport */
  distance: number
  /** how high the slow orbit rides, which changes the angle as well as the zoom */
  height: number
  /** put the graph in this section's state. Given the subject and its far end. */
  enter: (subject: string, far: string | null) => void
}

const store = () => useGraphStore.getState()

export const SECTIONS: Section[] = [
  {
    id: "impact",
    lens: "impact",
    eyebrow: "impact",
    title: "See what breaks before you touch the code.",
    body: "Select a file and trame walks every importer of every importer. The wave leaves the change ring by ring, so you read propagation rather than a flat highlight — and you know the blast radius before you open the editor.",
    distance: 52,
    height: 8,
    enter: (subject) => {
      store().select(subject)
      if (store().lens !== "impact") store().toggleImpact()
    },
  },
  {
    id: "path",
    lens: "path",
    eyebrow: "path",
    title: "Trace how two files ever got connected.",
    body: "Pick a second file and the dependency chain between them lights up. Not a search result — the actual route, hop by hop, through the files nobody remembers writing.",
    distance: 45,
    height: 3,
    enter: (subject, far) => {
      store().select(subject)
      if (far) store().tracePathTo(far)
    },
  },
  {
    id: "whatif",
    lens: "whatif",
    eyebrow: "what if",
    title: "Delete it in simulation first.",
    body: "Ask what removing a file would cost and the answer is drawn, not guessed: what disappears with it, what is left stranded, what breaks outright. The codebase on disk is untouched.",
    distance: 48,
    height: -5,
    enter: (subject) => {
      store().select(subject)
      if (store().lens !== "whatif") store().toggleWhatIf()
    },
  },
  {
    id: "cochange",
    lens: "cochange",
    eyebrow: "co-change",
    title: "The coupling no import declares.",
    body: "Some files always change together and nothing in the code says so — a route and the form that edits it, two handlers that must stay in step. trame reads the commits, keeps the pairs no import already explains, and draws what your dependency graph structurally cannot see.",
    distance: 50,
    height: 7,
    // its own subject: the file the rest of the page is about never travels
    // with anything, so this beat reads the graph again for its own question
    enter: () => {
      const s = coChangeSubjectOf()
      if (!s) return
      store().select(s.id)
      if (store().lens !== "cochange") store().toggleCoChange()
    },
  },
  {
    id: "hotspots",
    lens: "hotspots",
    eyebrow: "hotspots",
    title: "Where the codebase is under pressure.",
    body: "A file rewritten every week is where mistakes are made. A file everything imports is where a mistake travels furthest. Neither is a finding alone — the pillar nothing has touched all year is a structure doing its job. trame lights the files that are both.",
    // the only beat about the whole map rather than about one file, so the
    // camera stands back far enough to see the ranking spread across it
    distance: 60,
    height: 11,
    enter: () => {
      /**
       * Let go first, then light them.
       *
       * No subject: this lens asks nothing of the reader, and passing one would
       * quietly teach the visitor that it needs a selection. And since the lens
       * takes no camera of its own — it annotates whatever is drawn rather than
       * reframing — this beat would otherwise inherit the co-change beat's
       * vantage and light the map from where the *previous* question left it.
       */
      store().clear()
      if (store().lens !== "hotspots") store().toggleHotspots()
    },
  },
  {
    id: "replay",
    lens: "replay",
    eyebrow: "replay",
    title: "Watch the architecture arrive.",
    body: "Every commit re-parsed and replayed in order, so you can see when the shape you are living with was decided. Files that survive a commit keep their place — only the newcomers move — which is what makes the growth readable instead of a reshuffle.",
    distance: 56,
    height: 6,
    // the playback is a sequence, not a state: useReplay owns it
    enter: () => {},
  },
  {
    id: "yours",
    lens: null,
    eyebrow: "yours",
    title: "Now take the camera.",
    body: "Every overlay you just watched is a keystroke away, and the graph is not a recording — drag it, grab an edge, bend its curve. Architecture shouldn't fight you.",
    distance: 58,
    height: 9,
    // the performance is over: nothing is lit, everything is reachable
    enter: () => store().clear(),
  },
]
