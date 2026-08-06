/** Constraint rules evaluated by `archviz` / `archviz check`. */
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
  ],
}
