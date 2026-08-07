# archviz_

> Interactive 3D frontend architecture visualizer — parse your codebase, explore it as a force-directed graph with hand-controllable Bézier edges.

Mermaid and existing tools generate diagrams where you can't control arrow routing. **archviz** parses your TypeScript/React code with `ts-morph`, renders it in real 3D (WebGPU), and gives you full manual control over every edge curve — plus an architectural rules engine that fails your CI when constraints break.

![archviz viewer](docs/archviz.png)

## What you get

- **Auto-parsed graph** — components, pages, hooks, API endpoints, TanStack Query keys, Zustand stores, React contexts, extracted straight from your source. No hand-written diagrams.
- **Controllable Bézier edges** — click an edge, drag its two lavender control points in 3D space, curves persist to JSON. The thing no other tool does.
- **Folders as neighbourhoods** — a clustering force pulls each folder's files into a compact district; semantic zoom fades folder labels in as you zoom out, like a map.
- **Impact analysis** — select a node, press `I`: everything that transitively depends on it lights up, fading with distance. *"If I change this, what breaks?"*
- **Path tracing** — shift-click a second node to light the dependency chain between them. *"Why does LoginPage depend on Chart?"*
- **Dead code & cycles** — files nothing imports render hollow; circular dependencies are detected (Tarjan SCC) and can fail CI.
- **Constraint rules** — declare architecture rules in `archviz.config.ts`; violations glow red in the graph and `archviz check` exits 1 for CI.
- **Diff mode** — `archviz diff --base main.json --head branch.json` renders what a branch did to your architecture: additions green, removals as red ghosts.
- **Jump to source** — click the file path (or press `O`) to open the file at its line in VS Code, Cursor, Windsurf or Zed.
- **Live pipeline** — `archviz watch` re-parses on save, the viewer hot-swaps the graph.
- **Calm by design** — nodes rest grey; color only lands with your attention (hover/selection lights the neighbourhood). Catppuccin Mocha/Latte, matching your terminal.

## Quickstart

```bash
pnpm install
pnpm build

# parse a project
pnpm --filter @archviz/parser dev -- \
  --src ./path/to/your/src \
  --out ./packages/viewer/public/archviz.json

# open the viewer
pnpm dev            # → http://localhost:5173
```

Or serve the built viewer standalone:

```bash
pnpm --filter @archviz/parser dev -- serve --data ./archviz.json --port 3000
```

## CLI

```
archviz --src ./src [--out ./archviz.json]     parse and write the graph
archviz check --src ./src                      evaluate rules, exit 1 on violations
archviz watch --src ./src [--out ...]          re-parse on file changes
archviz serve --data ./archviz.json [--port]   serve the built viewer
archviz diff --base a.json --head b.json       what a branch did to the architecture

--tsconfig ./tsconfig.json    resolve paths through a tsconfig
--config ./archviz.config.ts  constraint rules (auto-detected in cwd)
--project name                project name in meta
--exclude a,b,c               extra path patterns to skip
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
// archviz.config.ts
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

Violations show up red in the graph (with the message in the inspector) and make `archviz check` exit 1 — wire it into CI and your architecture stops drifting.

## Stack

| | |
|---|---|
| Three.js **r185** | WebGPU renderer, automatic WebGL2 fallback |
| React Three Fiber 9 + drei 10 | scene |
| ts-morph 28 | TypeScript AST parsing |
| d3-force-3d | 3D force layout + custom cluster force |
| TypeScript 7 (native) · Vite 8 · Turborepo | toolchain |
| zustand · cmdk · Tailwind 4 | state · palette · UI |

## Monorepo

```
packages/
├── parser/    # CLI — AST parsing, graph build, rules, watch, serve
└── viewer/    # Browser — 3D scene, inspector, command palette
```

Dogfooded: the demo graph you see is archviz's own viewer source, parsed by its own parser.
