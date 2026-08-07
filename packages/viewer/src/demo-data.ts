import type { GraphData } from "./types"

/** Tiny fallback graph shown when no trame.json is served. */
export const DEMO: GraphData = {
  meta: { project: "demo", generated: new Date().toISOString(), nodeCount: 8, edgeCount: 9 },
  nodes: [
    { id: "pages/UserPage.tsx", label: "UserPage", type: "page", file: "", line: 1, cluster: "user" },
    { id: "components/UserCard.tsx", label: "UserCard", type: "component", file: "", line: 1, cluster: "user" },
    { id: "components/Avatar.tsx", label: "Avatar", type: "component", file: "", line: 1, cluster: "shared" },
    { id: "hooks/useUser.ts", label: "useUser", type: "hook", file: "", line: 1, cluster: "user" },
    { id: "hooks/useAuth.ts", label: "useAuth", type: "hook", file: "", line: 1, cluster: "auth" },
    { id: "api/client.ts", label: "client", type: "api", file: "", line: 1, cluster: "shared" },
    { id: "context/AuthProvider.tsx", label: "AuthProvider", type: "context", file: "", line: 1, cluster: "auth" },
    { id: "store/theme.ts", label: "themeStore", type: "store", file: "", line: 1, cluster: "shared" },
  ],
  edges: [
    { id: "e1", source: "pages/UserPage.tsx", target: "components/UserCard.tsx", type: "component" },
    { id: "e2", source: "pages/UserPage.tsx", target: "hooks/useUser.ts", type: "import" },
    { id: "e3", source: "components/UserCard.tsx", target: "components/Avatar.tsx", type: "component" },
    { id: "e4", source: "components/UserCard.tsx", target: "store/theme.ts", type: "import" },
    { id: "e5", source: "hooks/useUser.ts", target: "api/client.ts", type: "api-call" },
    { id: "e6", source: "hooks/useAuth.ts", target: "api/client.ts", type: "api-call" },
    { id: "e7", source: "hooks/useAuth.ts", target: "context/AuthProvider.tsx", type: "context" },
    { id: "e8", source: "pages/UserPage.tsx", target: "context/AuthProvider.tsx", type: "context" },
    { id: "e9", source: "components/Avatar.tsx", target: "store/theme.ts", type: "import" },
  ],
  clusters: [
    { id: "user", label: "user", color: "#89b4fa", nodeIds: ["pages/UserPage.tsx", "components/UserCard.tsx", "hooks/useUser.ts"] },
    { id: "auth", label: "auth", color: "#cba6f7", nodeIds: ["hooks/useAuth.ts", "context/AuthProvider.tsx"] },
    { id: "shared", label: "shared", color: "#94e2d5", nodeIds: ["components/Avatar.tsx", "api/client.ts", "store/theme.ts"] },
  ],
}
