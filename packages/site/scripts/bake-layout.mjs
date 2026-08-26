// Bake the layout into the demo data so the landing runs no solver at all:
// nothing settles before the first paint, and the arrival cascade can be
// choreographed because every node already knows where it lands.
//
// The solver is imported from the viewer, not reimplemented, so the baked file
// matches what a visitor clicking through sees.
import { readFileSync, writeFileSync } from "node:fs"
import { runLayout } from "@trame/viewer/scene/Layout"

const path = new URL("../public/demo.json", import.meta.url)
const graph = JSON.parse(readFileSync(path, "utf8"))

// runLayout warm-starts from positions already in the file, which is right for
// a save in watch mode and wrong here: re-baking would nudge the layout further
// every run. Stripping them forces the cold solve, which d3 seeds
// deterministically, so the same graph always bakes to the same coordinates.
const cold = {
  ...graph,
  nodes: graph.nodes.map(({ x: _x, y: _y, z: _z, ...rest }) => rest),
}

const positions = runLayout(cold)

graph.nodes = graph.nodes.map((n) => {
  const [x, y, z] = positions.get(n.id)
  return { ...n, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) }
})

writeFileSync(path, JSON.stringify(graph, null, 2))
console.log(`baked ${graph.nodes.length} positions`)
