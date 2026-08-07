import fs from "node:fs"
import http from "node:http"
import path from "node:path"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
}

export interface ServeOptions {
  dataFile: string
  distDir: string
  port: number
}

/**
 * Static server for the built viewer. `/trame.json` is read from disk on
 * every request — run `trame watch` next to it and the browser follows.
 */
export function serve({ dataFile, distDir, port }: ServeOptions): void {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    console.error(`error: viewer build not found at ${distDir}\n       run: pnpm --filter @trame/viewer build`)
    process.exit(1)
  }

  const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/"

    if (url === "/trame.json") {
      try {
        const buf = fs.readFileSync(dataFile)
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        res.end(buf)
      } catch {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end(`data file not found: ${dataFile}`)
      }
      return
    }

    let filePath = path.normalize(path.join(distDir, url === "/" ? "index.html" : url))
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, "index.html") // SPA fallback
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    })
    fs.createReadStream(filePath).pipe(res)
  })

  server.listen(port, () => {
    console.log(`trame · serving viewer at http://localhost:${port}\n  data: ${dataFile}`)
  })
}
