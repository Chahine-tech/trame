import { useEffect, useState } from "react"

const SEEN_KEY = "trame-seen-hint"

/**
 * One line, once. Not a tour — just enough to reveal that nodes respond and
 * edges are clickable (the differentiator nobody discovers on their own).
 * Dismisses on the first real interaction.
 */
export function FirstRunHint() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(SEEN_KEY))

  useEffect(() => {
    if (!visible) return
    const dismiss = () => {
      localStorage.setItem(SEEN_KEY, "1")
      setVisible(false)
    }
    // any real interaction means they're already exploring
    window.addEventListener("pointerdown", dismiss, { once: true })
    window.addEventListener("keydown", dismiss, { once: true })
    const timer = setTimeout(dismiss, 15000)
    return () => {
      window.removeEventListener("pointerdown", dismiss)
      window.removeEventListener("keydown", dismiss)
      clearTimeout(timer)
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className="first-hint">
      <span>hover a node</span>
      <i>·</i>
      <span>
        click an <b>edge</b> to bend it
      </span>
      <i>·</i>
      <span>
        <kbd>?</kbd> shortcuts
      </span>
    </div>
  )
}
