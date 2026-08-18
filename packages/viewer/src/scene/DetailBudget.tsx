import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { useGraphStore } from "../store/graph"
import type { Vec3 } from "../types"

/**
 * How many files the detail view may hold at once.
 *
 * Measured on cal.com, walking outwards from its most connected file: 200 files
 * (about 1090 draw calls) and 500 files (about 4450) are both comfortable;
 * 1000 files — 3681 imports between them, some 9360 draw calls — is neither
 * smooth nor legible. Two separate ceilings happen to sit close together, and
 * the lower one is the eye's: even rendered perfectly, a thousand files at once
 * says nothing. The budget is set below both.
 *
 * Note that edges, not nodes, dominate the cost — they outnumber files roughly
 * three to one at this scale, and each is a tube plus an arrowhead.
 */
export const BUDGET = 400

/** The nearest `BUDGET` files to a point, or null when they all fit anyway. */
export function nearestTo(
  ids: string[],
  positions: Map<string, Vec3>,
  at: Vec3,
): Set<string> | null {
  if (ids.length <= BUDGET) return null
  const ranked = ids
    .map((id) => {
      const p = positions.get(id)
      if (!p) return { id, d: Infinity }
      const dx = p[0] - at[0]
      const dy = p[1] - at[1]
      const dz = p[2] - at[2]
      return { id, d: dx * dx + dy * dy + dz * dz }
    })
    .sort((a, b) => a.d - b.d)
  return new Set(ranked.slice(0, BUDGET).map((r) => r.id))
}

/**
 * How far the camera's target must travel before the neighbourhood is redrawn.
 *
 * Recomputing continuously would swap nodes in and out on the smallest drift,
 * which reads as flickering rather than as movement. This is the same reasoning
 * as the two thresholds in ZoomDirector, applied to position instead of
 * distance.
 */
const RESTEP = 14

const LOOKING_AT = new THREE.Vector3()

/**
 * Keeps the detail view within a fixed budget, drawing the files nearest to
 * whatever the camera is pointed at.
 *
 * A hard count rather than a radius: a budget in files is a budget in draw
 * calls, whatever the density of the region, so the frame rate cannot depend on
 * where in the repository the reader happens to stand. Under the budget — every
 * graph the tool has drawn until now — nothing is withheld at all.
 */
export function DetailBudget() {
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null
  const camera = useThree((s) => s.camera)
  const last = useRef<THREE.Vector3 | null>(null)

  useFrame(() => {
    const store = useGraphStore.getState()
    const data = store.data
    if (!data) return

    // districts already stand in for files up there; nothing to hold back
    if (store.districtMode || data.nodes.length <= BUDGET) {
      last.current = null
      store.setNearby(null)
      return
    }

    // what the reader is looking at, not where they are standing: orbiting
    // around a fixed point should not keep changing which files are drawn
    LOOKING_AT.copy(controls?.target ?? camera.position)
    if (last.current && last.current.distanceTo(LOOKING_AT) < RESTEP) return
    last.current = LOOKING_AT.clone()

    const { positions, litSet, selectedId } = store
    const nearby = nearestTo(
      data.nodes.map((n) => n.id),
      positions,
      [LOOKING_AT.x, LOOKING_AT.y, LOOKING_AT.z],
    )
    if (!nearby) {
      store.setNearby(null)
      return
    }
    // whatever the reader is working on stays on screen even if they have
    // orbited away from it — losing your own selection is never an improvement
    for (const id of litSet) nearby.add(id)
    if (selectedId) nearby.add(selectedId)
    store.setNearby(nearby)
  })

  return null
}
