import { execFileSync } from "node:child_process"
import path from "node:path"
import type { CoChange, GraphData } from "./types.js"

/**
 * Two files that keep changing in the same commit without importing each other.
 *
 * The import graph draws what the code says. This draws what the history says,
 * and the interesting pairs are the ones the import graph cannot see: a route
 * and the schema it happens to mirror, a component and the fixture that has to
 * match it. Nothing connects them, so nothing warns you when one moves.
 */

export interface CoChangeOptions {
  /**
   * Commits touching more files than this are dropped.
   *
   * A commit is a claim that its files belong together, and a sweep is not
   * making that claim: one pass over 200 files invents 19 900 pairs, every one
   * of them false. Real commits are small, so the cap costs almost nothing.
   */
  maxFilesPerCommit: number
  /** a pair has to have happened this many times before it means anything */
  minTogether: number
  /** and hold at least this share of the commits that touched either file */
  minJaccard: number
}

/**
 * Measured on dub: 19 784 commits, of which 5 587 touch two or more files the
 * graph holds, against its 3 547 nodes.
 *
 * Commits run to a median of 3 files and a p90 of 8, with one outlier at 1 029,
 * so a cap of 20 keeps 98% of them and takes the sweeps. The rest was chosen
 * for how much survives, because a lens showing everything shows nothing:
 *
 *              j>=0.2   j>=0.3   j>=0.4   j>=0.5
 *   >=3 times     624      384      222      165
 *   >=5 times     272      172       95       62
 *   >=8 times     131       94       60       38
 *
 * At 5 times and 0.4 that is 95 pairs over 3 547 files, one for every 37, and
 * the top of the list is `create-tag.ts` with `get-tags.ts`, the two Stripe
 * webhook handlers that moved together 38 times, and the OAuth token pair.
 * Loosening to 3 and 0.3 gives 384, four times as many and mostly weaker.
 *
 * These were 40 / 3 / 0.3 when they were a guess, which on the same history
 * would have drawn some 400 edges.
 */
export const DEFAULTS: CoChangeOptions = {
  maxFilesPerCommit: 20,
  minTogether: 5,
  minJaccard: 0.4,
}

/**
 * The pairs, from commits already reduced to their file lists.
 *
 * Separated from the git call so the arithmetic can be exercised without a
 * repository, the same split `replay.ts` makes between `listCommits` and
 * `pickEvenly`.
 *
 * `known` is the set of files the graph holds: history remembers deleted files,
 * renamed files and everything that never was a module, and a pair the viewer
 * cannot draw is a pair worth not computing. It also keeps tests out for free,
 * since the parser does not put them in the graph.
 *
 * `linked` is the import graph as undirected adjacency. Pairs it already
 * connects are dropped: those are visible on screen already.
 *
 * Pairs are counted in a nested map rather than under a joined key. A path can
 * hold very nearly any character, so every separator is a guess about what will
 * never appear in one.
 */
export function coChanges(
  commits: string[][],
  known: Set<string>,
  linked: Map<string, Set<string>>,
  opts: CoChangeOptions = DEFAULTS,
): CoChange[] {
  const touched = new Map<string, number>()
  const pairs = new Map<string, Map<string, number>>()

  for (const commit of commits) {
    const files = [...new Set(commit)].filter((f) => known.has(f)).sort()
    if (files.length < 2 || files.length > opts.maxFilesPerCommit) continue
    for (const f of files) touched.set(f, (touched.get(f) ?? 0) + 1)
    for (let i = 0; i < files.length; i++) {
      const a = files[i]!
      let row = pairs.get(a)
      if (!row) pairs.set(a, (row = new Map()))
      for (let j = i + 1; j < files.length; j++) {
        const b = files[j]!
        row.set(b, (row.get(b) ?? 0) + 1)
      }
    }
  }

  const out: CoChange[] = []
  for (const [a, row] of pairs) {
    for (const [b, together] of row) {
      if (together < opts.minTogether) continue
      // a pair the import graph already draws is not news. What is left is the
      // coupling nothing on screen accounts for, which is the whole point
      if (linked.get(a)?.has(b)) continue
      const union = (touched.get(a) ?? 0) + (touched.get(b) ?? 0) - together
      const jaccard = union > 0 ? together / union : 0
      if (jaccard < opts.minJaccard) continue
      out.push({ a, b, together, jaccard })
    }
  }

  // strongest first, then by how often, so the same history writes the same file
  return out.sort(
    (x, y) => y.jaccard - x.jaccard || y.together - x.together || x.a.localeCompare(y.a),
  )
}

/** Unit separator, emitted by git itself so no control character is typed here. */
const SEP = String.fromCharCode(31)

/**
 * Every commit in the window as its list of changed files.
 *
 * One `git log` pass, where `replay.ts` needs a worktree per frame: the names
 * are in the log itself, so nothing is checked out. `hotspots.ts` reads the same
 * log through `readCommits`, which keeps the dates this one throws away.
 *
 * Deliberately no `-M`. Rename detection compares contents, so it needs the
 * blobs, and it fails outright on the partial clones CI tends to hand you: on a
 * `--filter=blob:none` clone of dub it errored where the same command without
 * it read 26 177 commits in under a minute. Without it a rename arrives as a
 * delete and an add, and the old path is dropped anyway for not being in the
 * graph, so the cost is a few commits of history for the file's new name.
 */
function readCommitFiles(repo: string, since: string): string[][] {
  return readCommits(repo, since).map((c) => c.files)
}

/** A commit in the window: when it landed, and what it touched. */
export interface Commit {
  /** committer timestamp, in seconds, as git reports it */
  at: number
  files: string[]
}

/**
 * The same pass, with the dates kept.
 *
 * `hotspots.ts` needs them and co-change does not, so the date is read once here
 * rather than in a second `git log` — on dub that pass is 26 177 commits, and
 * running it twice to recover a field git was already willing to print would be
 * silly.
 *
 * A commit whose header will not parse is dropped rather than dated zero: an
 * undated commit counted as 1970 is a commit that silently never looks recent.
 */
export function readCommits(repo: string, since: string): Commit[] {
  const raw = execFileSync(
    "git",
    ["-C", repo, "log", "--name-only", `--since=${since}`, "--pretty=format:%x1f%ct"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  )
  const out: Commit[] = []
  for (const block of raw.split(SEP)) {
    const lines = block.split("\n")
    const at = Number(lines[0]?.trim())
    if (!Number.isFinite(at) || at <= 0) continue
    const files = lines
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
    if (files.length > 0) out.push({ at, files })
  }
  return out
}

/**
 * The pairs for a graph, in the ids the viewer uses.
 *
 * Two path systems meet here and neither is wrong. Node ids are relative to
 * `--src`, because a graph should not carry the shape of the disk it was parsed
 * on; git names files relative to the repository root. `apps/web/` is the whole
 * of the difference on dub, and the mapping is a prefix in each direction.
 *
 * Returns nothing rather than throwing when there is no repository, no git, or
 * no history to read: co-change is something a graph may have, not something a
 * parse depends on.
 */
export function coChangeFor(
  graph: GraphData,
  repo: string,
  srcRoot: string,
  since: string,
  opts: CoChangeOptions = DEFAULTS,
): CoChange[] {
  const prefix = path.relative(path.resolve(repo), path.resolve(srcRoot)).split(path.sep).join("/")
  if (prefix.startsWith("..")) return []
  const at = (id: string) => (prefix ? `${prefix}/${id}` : id)
  const back = (p: string) => (prefix ? p.slice(prefix.length + 1) : p)

  const known = new Set(graph.nodes.map((n) => at(n.id)))
  const linked = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let row = linked.get(a)
    if (!row) linked.set(a, (row = new Set()))
    row.add(b)
  }
  for (const e of graph.edges) {
    link(at(e.source), at(e.target))
    link(at(e.target), at(e.source))
  }

  let commits: string[][]
  try {
    commits = readCommitFiles(repo, since)
  } catch {
    return []
  }
  return coChanges(commits, known, linked, opts).map((c) => ({
    ...c,
    a: back(c.a),
    b: back(c.b),
  }))
}
