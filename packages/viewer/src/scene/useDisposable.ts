import { useEffect } from "react"

interface Disposable {
  dispose(): void
}

/**
 * Frees a GPU resource when it is replaced or the component unmounts.
 *
 * R3F only disposes what it builds from JSX; a geometry created in userland
 * and handed over through the `geometry` prop is ours to release. Without
 * this, every hover that rebuilds a tube leaks its vertex buffers.
 */
export function useDisposable(resource: Disposable | null): void {
  useEffect(() => {
    if (!resource) return
    return () => resource.dispose()
  }, [resource])
}
