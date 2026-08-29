import { useEffect, useRef, useState } from "react"

/**
 * Which section holds the viewport. Index -1 is the hero.
 *
 * An IntersectionObserver fires only when a boundary is crossed, so a fling to
 * the bottom costs a handful of callbacks instead of a scroll handler
 * recomputing layout on every frame.
 */
export function useActiveSection(count: number): {
  active: number
  register: (index: number) => (el: HTMLElement | null) => void
} {
  const [active, setActive] = useState(-1)
  const elements = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = elements.current.indexOf(entry.target as HTMLElement)
          if (index === -1) continue
          // Entering from either direction claims the stage.
          if (entry.isIntersecting) {
            setActive(index)
            continue
          }
          // left upward (now above the band): the next section claims the
          // stage on its own, so there is nothing to hand back
          if (entry.boundingClientRect.top <= 0) continue
          /**
           * Scrolled up past it: hand back, but only if this section was the
           * one holding the viewport. The observer reports every target once on
           * connect, all below the band with top > 0, so stepping back
           * unconditionally opened the page on the last section.
           */
          setActive((current) => (current === index ? index - 1 : current))
        }
      },
      // the middle band: a section takes over once it owns the centre of the
      // screen, not the moment its first pixel appears
      { rootMargin: "-45% 0px -45% 0px" },
    )

    for (const el of elements.current) if (el) observer.observe(el)
    return () => observer.disconnect()
    // `count` is the trigger, not a value read here: the body observes whatever
    // `elements.current` holds, and that array is only as long as `count` says
  }, [count])

  const register = (index: number) => (el: HTMLElement | null) => {
    elements.current[index] = el
  }

  return { active, register }
}
