import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    /**
     * Source only. `build` compiles the package — tests included — into dist/,
     * and vitest's default glob then collected both copies: 24 tests reported
     * as 48, half of them running against whatever the last build happened to
     * emit. A stale dist would have gone on passing after the source broke.
     */
    include: ["src/**/*.test.ts"],
  },
})
