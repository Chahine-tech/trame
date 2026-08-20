/**
 * Where file labels announce themselves so the scene can arbitrate between
 * them.
 *
 * A module-level registry rather than props threaded down: a node's label is
 * born inside a `Html` portal several layers below the scene, and the only
 * thing the scene needs from it is a rectangle. Passing a callback through
 * every mesh to collect one element each would be a lot of wiring for a list.
 */
const elements = new Map<string, HTMLElement>()

export function registerLabel(id: string, el: HTMLElement | null): void {
  if (el) elements.set(id, el)
  else elements.delete(id)
}

export function labelElements(): Map<string, HTMLElement> {
  return elements
}
