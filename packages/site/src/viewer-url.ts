/**
 * Where the hosted viewer lives, set at build time.
 *
 * The fallbacks differ by environment on purpose: unset in production, the
 * localhost URL would be a dead link on the primary call to action, on every
 * machine but the author's.
 */
/** The source, which is also where the call to action falls back to. */
export const REPO = "https://github.com/Chahine-tech/trame"

export const DEMO_URL =
  import.meta.env.VITE_VIEWER_URL ?? (import.meta.env.DEV ? "http://localhost:5173/" : REPO)
