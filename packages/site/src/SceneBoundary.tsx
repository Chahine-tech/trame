import { Component, type ReactNode } from "react"

/**
 * Keeps a failing 3D scene from taking the page down with it.
 *
 * No WebGL, hardware acceleration off, an old driver: without this the
 * exception reaches the root and React unmounts the whole page, headline and
 * links included, on exactly the machines that cannot be tested from here.
 * On failure it renders nothing and the copy stands on its own.
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
