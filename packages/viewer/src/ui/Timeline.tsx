import { useEffect, useRef, useState } from "react"
import { useGraphStore } from "../store/graph"

/** Seconds a frame stays on screen while playing. */
const FRAME_MS = 1100

/**
 * Scrub the architecture through its own history. Layout continuity does the
 * heavy lifting: because a reload seeds the simulation from the previous
 * positions, a file that survives a commit keeps its place, so the eye can
 * actually follow what appeared and what went away.
 */
export function Timeline() {
  const active = useGraphStore((s) => s.lens === "replay")
  const timeline = useGraphStore((s) => s.timeline)
  const index = useGraphStore((s) => s.frameIndex)
  const showFrame = useGraphStore((s) => s.showFrame)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!playing || !timeline || !active) return
    timer.current = setInterval(() => {
      const s = useGraphStore.getState()
      const next = s.frameIndex + 1
      if (!s.timeline || next >= s.timeline.frames.length) {
        setPlaying(false)
        return
      }
      s.showFrame(next)
    }, FRAME_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [playing, timeline, active])

  if (!active || !timeline) return null

  const frame = timeline.frames[index]
  if (!frame) return null

  const atEnd = index >= timeline.frames.length - 1

  return (
    <div className="timeline">
      <button
        className="tl-play"
        onClick={() => {
          // replaying from the end should start over, not sit there
          if (!playing && atEnd) showFrame(0)
          setPlaying((v) => !v)
        }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <input
        className="tl-range"
        type="range"
        min={0}
        max={timeline.frames.length - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false)
          showFrame(Number(e.target.value))
        }}
        aria-label="Commit"
      />

      <div className="tl-meta">
        <span className="tl-subject" title={frame.subject}>
          {frame.subject || frame.sha}
        </span>
        <span className="tl-facts">
          <span className="sha">{frame.sha}</span>
          <span>{new Date(frame.date).toLocaleDateString()}</span>
          <span>{frame.nodeCount} files</span>
          {frame.added.length > 0 && <span className="add">+{frame.added.length}</span>}
          {frame.removed.length > 0 && <span className="del">−{frame.removed.length}</span>}
          {frame.violations > 0 && <span className="viol">✗ {frame.violations}</span>}
        </span>
      </div>

      <span className="tl-count">
        {index + 1}/{timeline.frames.length}
      </span>
    </div>
  )
}
