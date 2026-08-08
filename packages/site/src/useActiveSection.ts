import { useEffect, useRef, useState } from "react"

/**
 * Which section currently holds the viewport, by observation rather than by
 * arithmetic on every scroll event.
 *
 * An IntersectionObserver fires only when a boundary is actually crossed, so
 * flinging to the bottom of the page costs a handful of callbacks instead of
 * a hundred scroll handlers each recomputing the same layout. It also means
 * the page never has to know the scroll position — the browser does.
 *
 * Index -1 is the hero: the top of the page, before any section has taken over.
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
           * Left downward — we scrolled up past it — so hand back to the
           * previous section, but only if this one was actually holding it.
           *
           * The observer reports every target once on connect, and at the top
           * of the page they are all below the band and all "not intersecting
           * with top > 0". Stepping back unconditionally meant each of those
           * first callbacks pushed the index along, and the page opened on the
           * last section instead of the hero: no script, no bubble, a lens
           * already applied. Guarding on the current value makes that opening
           * burst a no-op, since none of them is active yet.
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
  }, [count])

  const register = (index: number) => (el: HTMLElement | null) => {
    elements.current[index] = el
  }

  return { active, register }
}
