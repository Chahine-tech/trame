// Bake the layout into the demo data so the landing runs no solver at all.
//
// Two things depend on this. Nothing has to settle before the first paint, so
// the graph is on screen at its final shape; and the arrival cascade can be
// choreographed at all, because every node already knows where it lands.
//
// The solver is the viewer's own — imported, not reimplemented. A second copy
// here would drift from the one the tool runs, and the baked file would stop
// matching what a visitor clicking through actually sees.
import { readFileSync, writeFileSync } from "node:fs"
import { runLayout } from "@trame/viewer/scene/Layout"

const path = new URL("../public/demo.json", import.meta.url)
const graph = JSON.parse(readFileSync(path, "utf8"))

// runLayout warm-starts from positions already in the file — right for a file
// save in watch mode, wrong here: re-baking would nudge the layout a little
// further every run. Stripping them forces the full cold solve, which d3 seeds
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
