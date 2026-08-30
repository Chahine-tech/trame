import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { GraphData, GraphEdge, GraphNode } from "./types.js"

export interface Commit {
  sha: string
  date: string
  subject: string
  author: string
}

export interface ReplayFrame {
  sha: string
  date: string
  subject: string
  author: string
  nodeCount: number
  edgeCount: number
  /** node ids that appeared in this commit */
  added: string[]
  /** node ids that disappeared in this commit */
  removed: string[]
  violations: number
  cycles: number
  /**
   * The whole architecture, carried by the first frame only.
   *
   * Every frame used to hold one. Measured on dub, forty frames of a 3547-file
   * codebase came to 7.3 MB gzipped with 97% of the nodes in any frame
   * byte-identical to the one before. Older replays still carry it on every
   * frame and still read.
   */
  graph?: GraphData
  /** what this commit changed, for every frame after the first */
  delta?: FrameDelta
}

/**
 * One commit's worth of change, enough to rebuild the frame from the one before.
 *
 * Additions and removals are the obvious part. Changes are not: a file that
 * stays put can move to another line, get renamed, or stop being a module and
 * start being a component, and that last one is drawn, since type decides shape
 * and colour. Measured on dub they are rare (3% move a line, a dozen change
 * type across forty frames) and leaving them out would be quietly lossy.
 */
export interface FrameDelta {
  addedNodes: GraphNode[]
  changedNodes: GraphNode[]
  removedNodes: string[]
  addedEdges: GraphEdge[]
  changedEdges: GraphEdge[]
  removedEdges: string[]
}

export interface Timeline {
  meta: {
    project: string
    generated: string
    frameCount: number
    from: string
    to: string
  }
  frames: ReplayFrame[]
}

/** Unit separator: safe inside commit subjects, unlike any printable char. */
const SEP = "\u001f"
const FORMAT = `--pretty=format:%H${SEP}%ad${SEP}%s${SEP}%an`

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // "Preparing worktree…" goes to stderr and would shred the progress line
    stdio: ["ignore", "pipe", "ignore"],
  })
}

/**
 * Pick at most `maxFrames` commits, evenly spread, oldest first.
 *
 * Counting frames rather than days is what makes this work on any repository: a
 * fixed interval collapses a week of intense work into one frame and explodes a
 * five-year history into hundreds. The budget is what the reader can watch, and
 * the stride follows from it.
 */
/**
 * Every commit in the window, oldest first.
 *
 * Separated from the sampling because they serve opposite needs: a replay has
 * to fit a viewer's patience and takes a budget, while a bisection probes
 * log₂(n) commits and is only made less precise by thinning the list first.
 */
export function listCommits(repo: string, since: string): Commit[] {
  const raw = git(repo, ["log", "--reverse", `--since=${since}`, "--date=iso-strict", FORMAT])
  const all: Commit[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject, author] = line.split(SEP)
      return { sha: sha!, date: date!, subject: subject ?? "", author: author ?? "" }
    })

  return all
}

/** At most `maxFrames` of them, evenly spread: what a replay can sit through. */
export function sampleCommits(repo: string, since: string, maxFrames: number): Commit[] {
  return pickEvenly(listCommits(repo, since), maxFrames)
}

/**
 * At most `maxFrames` commits, evenly spread, first and last always kept.
 *
 * Separated from the git call so the arithmetic can be exercised without a
 * repository: this is the part that decides whether a replay reads as growth
 * or as a slideshow, and it is entirely a function of a list and a budget.
 */
export function pickEvenly(all: Commit[], maxFrames: number): Commit[] {
  if (all.length === 0) return []
  if (maxFrames < 2) return all.slice(-1)
  if (all.length <= maxFrames) return all

  // even stride over the commit list, first and last always kept
  const stride = (all.length - 1) / (maxFrames - 1)
  const picked: Commit[] = []
  for (let i = 0; i < maxFrames; i++) {
    const commit = all[Math.round(i * stride)]
    if (commit && picked[picked.length - 1]?.sha !== commit.sha) picked.push(commit)
  }
  const head = all[all.length - 1]!
  if (picked[picked.length - 1]?.sha !== head.sha) picked.push(head)
  return picked
}

/**
 * Check out each sampled commit into a throwaway worktree and hand it to the
 * caller's parser. A worktree leaves the working copy untouched, so this is
 * safe to run while you keep editing.
 */
/**
 * Run something against a throwaway checkout of one commit.
 *
 * A worktree rather than a checkout, so the copy you are editing is never
 * touched. Returns null when the commit does not parse: history contains broken
 * states, and refusing to walk past them would make every history feature
 * useless on a real repository.
 */
export function atCommit<T>(
  repo: string,
  commit: Commit,
  fn: (checkoutRoot: string) => T | null,
): T | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trame-at-"))
  const dir = path.join(tmp, commit.sha.slice(0, 12))
  try {
    git(repo, ["worktree", "add", "--detach", dir, commit.sha])
    return fn(dir)
  } catch {
    return null
  } finally {
    try {
      git(repo, ["worktree", "remove", "--force", dir])
    } catch {
      /* already gone */
    }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export function forEachCommit(
  repo: string,
  commits: Commit[],
  parseAt: (checkoutRoot: string, commit: Commit, index: number) => GraphData | null,
  onProgress?: (index: number, total: number, commit: Commit) => void,
): { commit: Commit; graph: GraphData }[] {
  const results: { commit: Commit; graph: GraphData }[] = []
  for (const [index, commit] of commits.entries()) {
    onProgress?.(index, commits.length, commit)
    const graph = atCommit(repo, commit, (dir) => parseAt(dir, commit, index))
    if (graph) results.push({ commit, graph })
  }
  return results
}

/** Diff consecutive graphs so each frame knows what that commit changed. */
/**
 * What one commit did to the graph, as the difference from the frame before.
 *
 * Written whole, a replay of a real codebase is the same three and a half
 * thousand files forty times over. Written as differences it is fifteen times
 * smaller and rebuilds byte for byte.
 */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function changesBetween(before: GraphData, after: GraphData): FrameDelta {
  const wasNode = new Map(before.nodes.map((n) => [n.id, n]))
  const wasEdge = new Map(before.edges.map((e) => [e.id, e]))
  const nowNodes = new Set(after.nodes.map((n) => n.id))
  const nowEdges = new Set(after.edges.map((e) => e.id))

  return {
    addedNodes: after.nodes.filter((n) => !wasNode.has(n.id)),
    changedNodes: after.nodes.filter((n) => wasNode.has(n.id) && !same(wasNode.get(n.id), n)),
    removedNodes: before.nodes.filter((n) => !nowNodes.has(n.id)).map((n) => n.id),
    addedEdges: after.edges.filter((e) => !wasEdge.has(e.id)),
    changedEdges: after.edges.filter((e) => wasEdge.has(e.id) && !same(wasEdge.get(e.id), e)),
    removedEdges: before.edges.filter((e) => !nowEdges.has(e.id)).map((e) => e.id),
  }
}

export function buildTimeline(
  project: string,
  parsed: { commit: Commit; graph: GraphData }[],
): Timeline {
  const frames: ReplayFrame[] = parsed.map(({ commit, graph }, i) => {
    const previous = i > 0 ? parsed[i - 1]!.graph : null
    const before = new Set(previous?.nodes.map((n) => n.id) ?? [])
    const now = new Set(graph.nodes.map((n) => n.id))

    const added: string[] = []
    for (const id of now) if (!before.has(id)) added.push(id)
    const removed: string[] = []
    for (const id of before) if (!now.has(id)) removed.push(id)

    return {
      sha: commit.sha.slice(0, 8),
      date: commit.date,
      subject: commit.subject,
      author: commit.author,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      // the very first frame is the starting point, not a burst of additions
      added: i === 0 ? [] : added,
      removed,
      violations: graph.violations?.length ?? 0,
      cycles: graph.analysis?.cycles.length ?? 0,
      // the first frame is the ground everything else is measured from
      ...(previous ? { delta: changesBetween(previous, graph) } : { graph }),
    }
  })

  return {
    meta: {
      project,
      generated: new Date().toISOString(),
      frameCount: frames.length,
      from: frames[0]?.date ?? "",
      to: frames[frames.length - 1]?.date ?? "",
    },
    frames,
  }
}
