// Put the built viewer inside the package, so `trame serve` has something to serve.
//
// The two are separate workspaces in this repository and a single artifact on
// npm: someone running `npx trame serve` has no monorepo to reach into. Run at
// pack time rather than committed, because a build output in git rots and
// doubles every diff.
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const built = fileURLToPath(new URL("../../viewer/dist", import.meta.url))

if (!existsSync(built)) {
  console.error("error: viewer not built\n       run: pnpm --filter @trame/viewer build")
  process.exit(1)
}

rmSync(`${pkg}viewer`, { recursive: true, force: true })
cpSync(built, `${pkg}viewer`, {
  recursive: true,
  // trame's own graph and its 14-commit replay ride along in the viewer's
  // public/ — 238 kB describing this repository, shipped to everyone who
  // installs the tool to look at theirs. `serve` reads the graph from the
  // --data path anyway, so the bundled copies are never even read.
  filter: (src) => !/[/\\]trame(-replay)?\.json$/.test(src),
})

/**
 * npm reads these from the package directory, not the repository root, and
 * silently ships nothing when they are missing — the listing page would have
 * been blank on a package whose whole pitch is written in that file.
 */
for (const f of ["README.md", "LICENSE"]) {
  copyFileSync(fileURLToPath(new URL(`../../../${f}`, import.meta.url)), `${pkg}${f}`)
}

console.log("→ staged the viewer build, README and LICENSE into the package")
