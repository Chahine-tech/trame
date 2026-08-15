# trame_

> **Google Maps for your frontend architecture.**

Parse any TypeScript codebase and explore it as an interactive 3D map. Trace how
two files got connected, see what breaks before you touch it, test an
architectural decision before you make it, and fail CI when the architecture
drifts.

**[See it running](https://trame-61t.pages.dev)** · **[Open the viewer](https://trame-viewer.pages.dev)** — the graph in
both is trame's own source, parsed by trame.

## Why

Hand-drawn architecture diagrams go stale the week after you draw them, and
nobody can read one past fifty nodes anyway. The generated kind route their
arrows for you and give you no say in the result.

trame doesn't ask you to draw a diagram at all. It reads your source with
`ts-morph` and turns the codebase itself into a map you can walk through, ask
questions of, and hold to a set of rules.

## Explore

- **Auto-parsed graph** — components, pages, hooks, API endpoints, TanStack Query keys, Zustand stores, React contexts, extracted straight from your source. No hand-written diagrams.
- **Controllable Bézier edges** — click an edge, drag its two lavender control points in 3D space, curves persist to JSON.
- **Folders as neighbourhoods** — a clustering force pulls each folder's files into a compact district; semantic zoom fades folder labels in as you zoom out, like a map.
- **Path tracing** — shift-click a second node to light the dependency chain between them. *"Why does LoginPage depend on Chart?"*
- **Jump to source** — click the file path (or press `O`) to open the file at its line in VS Code, Cursor, Windsurf or Zed.
- **Live pipeline** — `trame watch` re-parses on save, the viewer hot-swaps the graph.

## Understand

- **Impact analysis** — select a node, press `I`: everything that transitively depends on it lights up, fading with distance. *"If I change this, what breaks?"*
- **What if?** — select a node, press `W`: what would break, what would be stranded, which cycles it would resolve, all without touching the codebase on disk.
- **Dead code & cycles** — files nothing imports render hollow; circular dependencies are detected (Tarjan SCC) and can fail CI.
- **Replay** — `trame replay` walks your git history and lets you scrub the architecture as it grew. Surviving files keep their position between frames, so the eye can follow what appeared and what went away.
- **Diff mode** — `trame diff --base main.json --head branch.json` renders what a branch did to your architecture: additions green, removals as red ghosts.

## Enforce

- **Constraint rules** — declare architecture rules in `trame.config.ts`; violations glow red in the graph and `trame check` exits 1 for CI.
- **A comment on every pull request** — what the branch did to the architecture, with a Mermaid diagram of just the changed neighbourhood. [Details below](#in-ci).

**Calm by design.** Nodes rest grey. Colour only lands with your attention, in Catppuccin Mocha or Latte to match your terminal.

## Quickstart

```bash
npm i -g tramejs

trame --src ./src              # parse — writes trame.json
trame serve                    # explore it in the browser
```

Or without installing: `npx tramejs --src ./src`.

Two commands and nothing to clone. Your code never leaves the machine either:
the parser reads it locally, and the viewer is a static bundle served off your
own disk.

```bash
trame watch --src ./src        # re-parse on save, the viewer follows
trame check --src ./src        # exit 1 if an architecture rule broke
```

### Working on trame itself

```bash
pnpm install && pnpm build
pnpm dev            # viewer   → http://localhost:5173
pnpm dev:site       # landing  → http://localhost:5174
pnpm parse -- --src ./path/to/src --out ./packages/viewer/public/trame.json
```

## Tests

```bash
pnpm test
```

29 tests, on the parts where being wrong is silent: Tarjan's SCC detection
(including a 20 000-node chain, since the implementation promises to be
iterative), the three constraint rules `trame check` exits on, the commit
sampler that decides whether a replay reads as growth or as a slideshow, and
the viewer's lens mutual exclusion.

## Diagrams for docs and PRs

Yes, trame exports to Mermaid, the format its own pitch complains about. People
need a diagram in their README, and GitHub renders Mermaid natively in issues, PR
comments and Markdown files:

```bash
trame --src ./src --format mermaid --out docs/architecture.mmd
trame --src ./src --format dot     --out docs/architecture.dot
```

Nodes keep their shape-per-type and Catppuccin colour, and folders become
subgraphs. From the viewer, `⌘K → Copy as Mermaid` puts the diagram on your
clipboard, scoped to the edge filter you are currently looking at.

## In CI

[`.github/workflows/trame.yml`](.github/workflows/trame.yml) comments on every
pull request with what it did to the architecture: nodes added or removed, new
dependency cycles, rule violations, and a Mermaid diagram of just the changed
neighbourhood. There is one comment per PR and it gets edited in place. Then
`trame check` fails the job if a rule broke.

Because GitHub renders Mermaid itself, this needs no headless browser, no image
hosting and no artifact upload. The diagram is text in the comment body.

```markdown
## trame

**+1** / **−0** nodes · +3 / −0 edges

### ✗ 1 rule violation
- `no-cycles` — Circular dependency (Card → Widget → Card)

<details><summary>Architecture diagram</summary>
…mermaid block GitHub renders inline…
</details>
```

Point `TRAME_SRC` and `TRAME_CONFIG` at your own paths and it works on any repo.

## CLI

```
trame --src ./src [--out ./trame.json]     parse and write the graph
trame check --src ./src                      evaluate rules, exit 1 on violations
trame watch --src ./src [--out ...]          re-parse on file changes
trame serve --data ./trame.json [--port]   serve the built viewer
trame diff --base a.json --head b.json       what a branch did to the architecture
trame replay --src ./src [--since --max-frames]  how the architecture grew, across git history

--format json|mermaid|dot|markdown   output shape (default json)
--tsconfig ./tsconfig.json    resolve paths through a tsconfig
--config ./trame.config.ts    constraint rules (auto-detected in cwd)
--project name                project name in meta
--exclude a,b,c               extra path patterns to skip
--data ./trame.json           (serve) graph file to serve
--port 3000                   (serve) port
--dist ./path                 (serve) viewer build override
--since "6 months ago"        (replay) how far back to walk
--max-frames 40               (replay) frame budget — the stride follows from it
--repo .                      (replay) repository root
```

## Keyboard

| Key | Action |
|---|---|
| `drag` | orbit · `wheel` zoom |
| `click` node | select + inspector |
| `double-click` node | focus camera |
| drag node | reposition it (6px threshold — below that it's a click) |
| `click` edge | show Bézier handles · drag to reshape · `double-click` reset |
| `I` | impact of selection (transitive dependents) |
| `shift-click` | trace dependency path from selection |
| `O` | open selection in your editor |
| `⌘K` / `/` | command palette (search nodes, commands) |
| `⌘E` | export PNG |
| `E` | cycle edge-type filter |
| `L` | toggle labels |
| `G` | toggle folder labels |
| `?` | all shortcuts, any time |
| `F` | focus selection · `Space` reset camera · `Esc` deselect |

## Node & edge language

| Node | Shape | Color | | Edge | Style |
|---|---|---|---|---|---|
| Page | octahedron | blue | | `import` | thin grey |
| Component | rounded box | green | | `component` | green |
| Hook | sphere | mauve | | `api-call` | peach |
| API endpoint | cylinder | peach | | `query-key` | pink |
| Query key | tetrahedron | pink | | `context` | yellow |
| Context | torus | yellow | | violation | **red** |
| Store | dodecahedron | teal | | | |

Nodes are sized by connectivity. At rest everything is grey — color is information, not decoration.

## Rules

```ts
// trame.config.ts
export default {
  rules: [
    {
      type: "unique-caller",
      match: { edgeType: "api-call", targetType: "api" },
      message: "API endpoint called from multiple hooks — extract a shared hook",
    },
    {
      type: "unique-caller",
      match: { edgeType: "query-key" },
      message: "Query key used in multiple queries — consolidate",
    },
    {
      type: "no-direct-import",
      match: { sourceType: "page", targetType: "page" },
      message: "Pages should not import each other directly",
    },
    {
      type: "no-cycles",
      message: "Circular dependency",
    },
  ],
}
```

Violations show up red in the graph, with the message in the inspector, and make `trame check` exit 1. Wire that into CI and your architecture stops drifting.

## Stack

| | |
|---|---|
| Three.js **r185** | WebGPU renderer, automatic WebGL2 fallback |
| React Three Fiber 9 + drei 10 | scene |
| ts-morph 28 | TypeScript AST parsing |
| d3-force-3d | 3D force layout + custom cluster force |
| TypeScript 7 (native) · Vite 8 · Turborepo | toolchain |
| zustand · cmdk · Tailwind 4 | state · palette · UI |
| goey-toast | feedback for things you can't see happen |

## Monorepo

```
packages/
├── parser/    # CLI — AST parsing, graph build, rules, watch, serve
├── viewer/    # Browser — 3D scene, inspector, command palette
└── site/      # Landing — the viewer's own meshes, no chrome
```

The landing imports the viewer's meshes and store rather than describing them,
so it cannot advertise a behaviour the tool does not have: scrolling a section
calls the same store action a keystroke would. It ships separately: set
`VITE_VIEWER_URL` to point its CTA at wherever the viewer is deployed.

Dogfooded, and checkable: every node in the graph on the landing is a real file
in `packages/viewer/src`, parsed by the real parser. `NodeMesh.tsx` and
`EdgeMesh.tsx` are in there, so the code drawing the graph is part of what it
draws.

## License

MIT
