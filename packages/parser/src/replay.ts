import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { GraphData } from "./types.js"

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
  graph: GraphData
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
 * Counting frames rather than days is what makes this work on any repo: a
 * fixed interval in days collapses a week of intense work into one frame, and
 * explodes a five-year history into hundreds. The budget is what the reader
 * can watch; the stride follows from it.
 */
export function sampleCommits(repo: string, since: string, maxFrames: number): Commit[] {
  const raw = git(repo, [
    "log",
    "--reverse",
    `--since=${since}`,
    "--date=iso-strict",
    FORMAT,
  ])
  const all: Commit[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject, author] = line.split(SEP)
      return { sha: sha!, date: date!, subject: subject ?? "", author: author ?? "" }
    })

  if (all.length === 0) return []
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
export function forEachCommit(
  repo: string,
  commits: Commit[],
  parseAt: (checkoutRoot: string, commit: Commit, index: number) => GraphData | null,
  onProgress?: (index: number, total: number, commit: Commit) => void,
): { commit: Commit; graph: GraphData }[] {
  const results: { commit: Commit; graph: GraphData }[] = []
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trame-replay-"))

  for (const [index, commit] of commits.entries()) {
    const dir = path.join(tmp, commit.sha.slice(0, 12))
    onProgress?.(index, commits.length, commit)
    try {
      git(repo, ["worktree", "add", "--detach", dir, commit.sha])
      const graph = parseAt(dir, commit, index)
      if (graph) results.push({ commit, graph })
    } catch {
      // a commit that doesn't parse is skipped, not fatal: history contains
      // broken states and the timeline should survive them
    } finally {
      try {
        git(repo, ["worktree", "remove", "--force", dir])
      } catch {
        /* already gone */
      }
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  return results
}

/** Diff consecutive graphs so each frame knows what that commit changed. */
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
      graph,
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
