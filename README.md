# trame_

> **Google Maps for your frontend architecture.**

Parse any TypeScript codebase and explore it as an interactive 3D map. Trace how
two files got connected, see what breaks before you touch it, test an
architectural decision before you make it, and fail CI when the architecture
drifts.

**[See it running](https://trame-61t.pages.dev)** — trame's own source, parsed by
trame. **[Open the viewer](https://trame-viewer.pages.dev)** — [dub](https://github.com/dubinc/dub),
3547 files, with a year of its history to scrub through.

## Why

Hand-drawn architecture diagrams go stale the week after you draw them, and
nobody can read one past fifty nodes anyway. The generated kind route their
arrows for you and give you no say in the result.

trame doesn't ask you to draw a diagram at all. It reads your source with
`ts-morph` and turns the codebase itself into a map you can walk through, ask
questions of, and hold to a set of rules.

The examples below are cal.com — 3,451 files across 114 folders, a codebase
nobody reading this wrote. Every number is what trame printed.

## Explore

```bash
npx tramejs --src ./src
trame serve
```

What opens is not a diagram. Files are nodes, shaped by what they are — page,
component, hook, store, context, API endpoint, query key. Imports are edges you
can bend and the curves persist. A clustering force pulls each folder into its
own district, and past a certain distance the files fade into the folders that
hold them, the way a map trades streets for cities.

On a codebase too large to draw at once, trame does not try. It picks out the
files that hold the structure up, then opens on the worst thing they are caught
in, with the neighbourhood around it already drawn.

Once you are there:

| | |
|---|---|
| `shift-click` a second file | lights the dependency chain between the two. *Why does LoginPage depend on Chart?* |
| `I` | everything that transitively depends on this file, fading with distance |
| `W` | what deleting it would break, what it would strand, which cycles it would resolve — without touching disk |
| `C` | the files your history keeps changing alongside this one that no import connects. *Nothing in the code says these belong together* |
| `O` | opens the file at its line in VS Code, Cursor, Windsurf or Zed |
| `⌘K` → *Copy link to this view* | puts the selection and the active question in the URL, so a colleague opens where you left off |

`trame watch` re-parses on save and the viewer swaps the graph under you.

## Understand

Ask what is worth fixing:

```bash
trame doctor --src ./packages
```

```
551 things worth fixing, top 2:

  ⟳ 106 files depend on each other in a loop: class → prismaNamespace → models … +100
    → Remove the import of models from prismaNamespace — verified to free 104 of them.

  ⟳ 8 files depend on each other in a loop: getCalendar → CalendarSubscriptionService
    → CalendarSyncService → handleCancelBooking → EventManager → CalendarManager
    → Remove the import of CalendarSubscriptionService from getCalendar — frees 6.
```

The cut is not a guess. A group of eight files can hold several distinct loops,
so removing the import that looks load-bearing may leave the tangle intact.
trame takes out each candidate in turn and recounts what stays caught, which is
why "frees 104" is a measurement and not an opinion.

Dead code is reported the same way, and phrased as the inference it is. Files
something else calls are left alone — router filenames, `*.config.ts`, and
anything under `scripts/`, `tests/` or `playwright/`, where no import exists to
find. On dub that is the difference between 650 unimported files and 46. What
survives is still an inference, since a dynamic import is invisible, so trame
says how many private helpers would go with a deletion rather than telling you
to delete anything.

Ask where the modules actually are:

```bash
trame modules --src ./packages
```

```
structure found: 0.685 · your folders: 0.427

trpc/ holds 2 groups that barely touch:
  · createContext, addNotificationsSubscription.handler, addSecondaryEmail.handler … +122
  · errorFormatter, perfMiddleware, sessionMiddleware, authedProcedure … +153

googlecalendar/ holds 2 groups that barely touch:
  · _metadata, CalendarAuth, CalendarService, google-calendar.e2e, testUtils
  · add, callback, index, getGoogleAppKeys
```

Handlers on one side, middleware on the other, inside one folder that claims to
be one thing. The service layer and the OAuth routes, likewise. Louvain finds
the groups from the imports alone; both groupings are then scored with Newman's
modularity, so 0.685 against 0.427 says the folder tree explains this codebase
about half as well as its own dependencies do.

Ask what the imports cannot tell you:

Every parse inside a git repository also reads the commits, and keeps the pairs
of files that keep changing together while **no import connects them**. Those
are the ones the dependency graph structurally cannot show — a route and the
form that edits it, two handlers that have to stay in step, a type mirrored in
another package.

Press `C` on a file and they light up. On dub: 19 784 commits, of which 5 587
touch two or more files in the graph, leaving 67 pairs across its 3 547 files.
The strongest are `create-tag.ts` with `get-tags.ts`, the two Stripe webhook
handlers that moved together 38 times, and the OAuth token pair.

Coupling is scored by Jaccard, not by raw co-occurrence, so a file that changes
with everything scores low rather than pairing with the whole repository, and
commits touching more than twenty files are dropped: a sweep is not a claim that
its files belong together. `--since` sets the window.

Ask who introduced it:

```bash
trame blame --src ./packages
```

```
19 traced through 2642 commits, 58 read:

  cycle: embed-iframe → embed → react-hooks
    73f51920 · refactor: move Booker hooks from packages/features to apps/web/modules

  cycle: schema → fieldTypes → variantsConfig
    older than the history read — try --since
```

`git blame` answers that for a line. A cycle is not written on any line: it
emerges from imports spread across the files it joins, and the commit that
closed the loop may have touched none of them meaningfully. trame bisects the
history instead, parsing the architecture at each probe, so the cost is
logarithmic rather than linear — and since the probes are shared between
questions, nineteen answers came out of fifty-eight checkouts rather than
nineteen searches' worth.

And ask how it got this way. `trame replay` walks the history and lets you scrub
the architecture as it grew; surviving files keep their position between frames,
so the eye follows what appeared and what went away. `trame diff --base a.json
--head b.json` does the same for one branch: additions green, removals as red
ghosts.

## Enforce

Write the rules down, in `trame.config.ts`:

```ts
export default {
  rules: [
    { type: "no-cycles", message: "Circular dependency" },
    {
      type: "no-direct-import",
      match: { sourceType: "page", targetType: "page" },
      message: "Pages should not import each other directly",
    },
  ],
}
```

```bash
trame check --src ./src
```

```
✗ [no-cycles] Circular dependency (CalendarEventBuilder → BookingRepository → IBookingRepository → CalendarEventBuilder)
```

Exit 1, so CI stops there. Violations glow red in the viewer with the message in
the inspector, and the config is validated before it runs: a rule typed
`no-cycle` instead of `no-cycles` used to match nothing, report nothing and pass
— a green build that checked nothing at all.

[`.github/workflows/trame.yml`](.github/workflows/trame.yml) also comments on
every pull request with what the branch did to the architecture, and edits that
comment in place rather than adding one. [Details below](#in-ci).

**Calm by design.** Nodes rest grey. Colour only lands with your attention, in
Catppuccin Mocha or Latte to match your terminal. Both grounds are held to the
same measured bar: every lens clears 3:1 against the surface it is drawn on, and
a test computes it from the palette that ships rather than trusting the eye.

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
pnpm knip           # exports, files and dependencies nothing reaches
pnpm check:package  # publint + are-the-types-wrong on the published package
```

## Tests

```bash
pnpm test
```

187 tests, on the parts where being wrong is silent.

In the parser: Tarjan's SCC detection, including a 20 000-node chain since the
implementation promises to be iterative; the three constraint rules `trame
check` exits on, and the validation that stops a misspelt rule passing quietly;
the dead-code rule, which has to know that a `route.ts` nobody imports is a
router convention rather than a corpse; the commit sampler that decides whether
a replay reads as growth or as a slideshow.

In the viewer, mostly geometry and colour, because those fail quietly and look
like taste: that a replay frame rebuilt from forty deltas equals the graph it
came from, that a folder name lands on a file rather than in the gap between
several, that an edge stays a line rather than a wash when the camera pulls
back, and that every lens clears 3:1 against the ground it is drawn on. That
last one reads `tokens.css` off disk and computes real contrast ratios, so it
asserts the palette that actually ships.

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
trame doctor --src ./src                     what to fix, worst first
trame blame --src ./src [--since]            which commit introduced each problem
trame modules --src ./src                    where the real module boundaries are
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
| `W` | what if — what deleting the selection would break |
| `C` | co-change — what the history moves with it, unimported |
| `shift-click` | trace dependency path from selection |
| `⌘Z` | take back a deselection — file, lens and vantage |
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
  // paths to keep off the map, on top of node_modules, dist, tests and stories
  exclude: ["src/generated", ".gen.ts"],

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
