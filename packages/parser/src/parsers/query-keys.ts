import { SyntaxKind, type Project } from "ts-morph"

export interface QueryKeyUsage {
  /** absolute path of the calling file */
  file: string
  line: number
  /** normalized queryKey/mutationKey source text, e.g. `["users", id]` */
  queryKey: string
  hook: string
}

const QUERY_HOOKS = new Set([
  "useQuery",
  "useSuspenseQuery",
  "useInfiniteQuery",
  "useMutation",
  "queryOptions",
  "infiniteQueryOptions",
])

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Find every TanStack Query call and pull out its query/mutation key. */
export function extractQueryKeys(project: Project): QueryKeyUsage[] {
  const usages: QueryKeyUsage[] = []

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().endsWith(".d.ts")) continue

    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const expr = call.getExpression().getText()
      if (!QUERY_HOOKS.has(expr)) return

      const options = call.getArguments()[0]
      if (!options || options.getKind() !== SyntaxKind.ObjectLiteralExpression) return

      const obj = options.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      const keyProp = obj.getProperty("queryKey") ?? obj.getProperty("mutationKey")
      if (!keyProp) return

      const assignment = keyProp.asKind(SyntaxKind.PropertyAssignment)
      const keyText = assignment?.getInitializer()?.getText() ?? keyProp.getText()

      usages.push({
        file: sourceFile.getFilePath(),
        line: call.getStartLineNumber(),
        queryKey: normalize(keyText),
        hook: expr,
      })
    })
  }

  return usages
}
