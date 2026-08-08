import { useGraphStore } from "@trame/viewer/store/graph"

/**
 * The page, declared rather than choreographed.
 *
 * Scroll is the clock. Each section names a question, poses the camera, and
 * asks the store the same thing a visitor's keystroke would — so the landing
 * cannot drift from the tool, and adding a beat is adding an entry here.
 *
 * Nothing is scroll-jacked. The page scrolls at its natural speed and a flick
 * to the bottom lands at the bottom; sections only decide *what is shown*
 * while they hold the viewport, never how fast you get there.
 */
export interface Section {
  id: string
  /**
   * Which lens this section turns on, or null when it turns them all off.
   *
   * Named here rather than inferred from `enter`, because the eyebrow has to be
   * that lens' colour — a label whose colour disagrees with the wave crossing
   * the graph is the exact defect this page keeps having to fix.
   */
  lens: "impact" | "path" | "whatif" | "replay" | null
  /** small label above the title */
  eyebrow: string
  title: string
  body: string
  /**
   * Orbit radius while this section holds the viewport. Larger reads as
   * standing back to take in the shape; smaller as moving in among the files.
   */
  distance: number
  /** how high the slow orbit rides — a change of angle, not just of zoom */
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
