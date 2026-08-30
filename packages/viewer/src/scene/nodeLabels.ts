/**
 * Where file labels announce themselves so the scene can arbitrate between
 * them.
 *
 * A module-level registry rather than props threaded down. The names are drawn
 * by `ui/NodeLabels`, which lives outside the canvas because R3F's reconciler
 * resolves every element against the THREE namespace; the scene, inside the
 * canvas, needs a rectangle from each of them. Threading a callback across that
 * boundary would be a lot of wiring for a list.
 */
const elements = new Map<string, HTMLElement>()

export function registerLabel(id: string, el: HTMLElement | null): void {
  if (el) elements.set(id, el)
  else elements.delete(id)
}

export function labelElements(): Map<string, HTMLElement> {
  return elements
}
