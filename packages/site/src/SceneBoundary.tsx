import { Component, type ReactNode } from "react"

/**
 * Keeps a failing 3D scene from taking the page down with it.
 *
 * Without this, an exception anywhere in the canvas — no WebGL, hardware
 * acceleration switched off, an old driver, a GPU that gives up — propagates to
 * the root and React unmounts everything. The visitor gets a blank white page:
 * no headline, no pitch, no link. And it happens on exactly the machines that
 * cannot be tested from here.
 *
 * On failure it renders nothing at all. The copy is written to stand on its own
 * and the page degrades to what it says rather than to nothing, which is the
 * difference between a plain landing and a broken one.
 */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    // worth a line in the console: silence here would hide a real regression
    console.warn("trame: the 3D scene could not start, showing the page without it", error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
