import type { GraphData, Timeline } from "../types"

/**
 * The architecture as it stood at one frame of a replay.
 *
 * Frames after the first carry only what their commit changed, so the graph has
 * to be rebuilt by walking forward from the first one. Written whole instead, a
 * replay of dub's 3547 files came to 7.3 MB gzipped for forty frames, because
 * 97% of every frame was byte-identical to the one before it.
 *
 * Walking is cheap so long as it does not start over each time. Scrubbing moves
 * a frame at a time in one direction, so the last position is kept and the walk
 * resumes from there; only jumping backwards pays for a rewind, and rewinding
 * forty frames of deltas is still a few milliseconds.
 */
export interface Replay {
  at: (index: number) => GraphData | null
}

export function replayOf(timeline: Timeline): Replay {
  const base = timeline.frames[0]?.graph
  if (!base) return { at: () => null }

  let cursor = 0
  let nodes = new Map(base.nodes.map((n) => [n.id, n]))
  let edges = new Map(base.edges.map((e) => [e.id, e]))

  const rewind = () => {
    cursor = 0
    nodes = new Map(base.nodes.map((n) => [n.id, n]))
    edges = new Map(base.edges.map((e) => [e.id, e]))
  }

  const step = () => {
    const frame = timeline.frames[cursor + 1]
    if (!frame) return false
    const delta = frame.delta
    if (delta) {
      for (const id of delta.removedNodes) nodes.delete(id)
      for (const n of delta.addedNodes) nodes.set(n.id, n)
      for (const n of delta.changedNodes) nodes.set(n.id, n)
      for (const id of delta.removedEdges) edges.delete(id)
      for (const e of delta.addedEdges) edges.set(e.id, e)
      for (const e of delta.changedEdges) edges.set(e.id, e)
    } else if (frame.graph) {
      // a replay written before the format carried differences
      nodes = new Map(frame.graph.nodes.map((n) => [n.id, n]))
      edges = new Map(frame.graph.edges.map((e) => [e.id, e]))
    }
    cursor++
    return true
  }

  return {
    at: (index) => {
      const frame = timeline.frames[index]
      if (!frame) return null
      // a frame that carries its own graph needs no walking at all
      if (frame.graph && index > 0) return frame.graph
      if (index < cursor) rewind()
      // `cursor` advances inside `step()`, so nothing in this line shows it
      // moving
      while (cursor < index && step()) {
        /* forward to the frame asked for */
      }
      return {
        ...base,
        meta: { ...base.meta, nodeCount: nodes.size, edgeCount: edges.size },
        nodes: [...nodes.values()],
        edges: [...edges.values()],
      }
    },
  }
}
