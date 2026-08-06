import { SyntaxKind, type CallExpression, type Project } from "ts-morph"

export interface ApiCallUsage {
  /** absolute path of the calling file */
  file: string
  line: number
  /** endpoint with template holes normalized, e.g. `/users/:id` */
  endpoint: string
  method: string
}

const HTTP_CLIENTS = new Set(["axios", "ky"])
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head"])

/** `/users/${id}` → `/users/:id` — stable identity across call sites. */
function normalizeEndpoint(raw: string): string {
  return raw
    .replace(/^[`'"]|[`'"]$/g, "")
    .replace(/\$\{[^}]*\}/g, ":param")
    .trim()
}

function firstArgEndpoint(call: CallExpression): string | null {
  const arg = call.getArguments()[0]
  if (!arg) return null
  const kind = arg.getKind()
  if (
    kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === SyntaxKind.TemplateExpression
  ) {
    return normalizeEndpoint(arg.getText())
  }
  return null
}

/** `fetch(url, { method: "POST" })` → POST; defaults to GET. */
function fetchMethod(call: CallExpression): string {
  const options = call.getArguments()[1]
  const obj = options?.asKind(SyntaxKind.ObjectLiteralExpression)
  const methodProp = obj?.getProperty("method")?.asKind(SyntaxKind.PropertyAssignment)
  const value = methodProp?.getInitializer()?.getText()
  return value ? value.replace(/['"`]/g, "").toUpperCase() : "GET"
}

/** Find fetch / axios.* / ky.* calls with literal-ish endpoints. */
export function extractApiCalls(project: Project): ApiCallUsage[] {
  const usages: ApiCallUsage[] = []

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().endsWith(".d.ts")) continue

    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const callee = call.getExpression()
      const file = sourceFile.getFilePath() as string
      const line = call.getStartLineNumber()

      // fetch("/users")
      if (callee.getText() === "fetch") {
        const endpoint = firstArgEndpoint(call)
        if (endpoint) usages.push({ file, line, endpoint, method: fetchMethod(call) })
        return
      }

      // axios.get("/users") · ky.post("/users")
      const access = callee.asKind(SyntaxKind.PropertyAccessExpression)
      if (access) {
        const object = access.getExpression().getText()
        const method = access.getName()
        if (HTTP_CLIENTS.has(object) && HTTP_METHODS.has(method)) {
          const endpoint = firstArgEndpoint(call)
          if (endpoint) usages.push({ file, line, endpoint, method: method.toUpperCase() })
        }
        return
      }

      // axios("/users", { method: "PUT" })
      if (HTTP_CLIENTS.has(callee.getText())) {
        const endpoint = firstArgEndpoint(call)
        if (endpoint) usages.push({ file, line, endpoint, method: fetchMethod(call) })
      }
    })
  }

  return usages
}
