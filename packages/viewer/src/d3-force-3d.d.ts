declare module "d3-force-3d" {
  export interface SimNode {
    id: string
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
    [key: string]: unknown
  }
  export interface Simulation {
    force(name: string, force: unknown): Simulation
    tick(iterations?: number): Simulation
    stop(): Simulation
    alpha(a?: number): number & Simulation
    on(event: string, cb: () => void): Simulation
    nodes(): SimNode[]
  }
  export function forceSimulation(nodes?: SimNode[], numDimensions?: number): Simulation
  export function forceLink(links?: unknown[]): {
    id(fn: (d: SimNode) => string): ReturnType<typeof forceLink>
    distance(d: number | ((l: unknown) => number)): ReturnType<typeof forceLink>
    strength(s: number | ((l: unknown) => number)): ReturnType<typeof forceLink>
  }
  export function forceManyBody(): { strength(s: number): ReturnType<typeof forceManyBody> }
  export function forceCenter(x?: number, y?: number, z?: number): unknown
  export function forceCollide(r?: number | ((d: SimNode) => number)): unknown
}
