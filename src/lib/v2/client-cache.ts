'use client'

/**
 * Tiny client-side fetch cache: TTL + in-flight de-duplication.
 *
 * Reference data (sessions, classes, classrooms, structures) barely changes
 * but was being refetched on every page mount and navigation. Caching it at
 * module scope means the second visit to a page — or two components asking
 * for the same URL at once — reuses one response instead of hitting the API
 * again. `invalidateClientCache()` (called after every mutation, see ui.tsx)
 * drops everything so writes are reflected immediately.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = new Map<string, { value: any; expires: number }>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inflight = new Map<string, Promise<any>>()

/**
 * Fetch `url` as JSON, serving a fresh-enough cached copy when available.
 * Only successful (2xx) responses are cached; errors pass through uncached.
 */
export async function cachedFetch<T = unknown>(url: string, ttlMs = 60_000): Promise<T> {
  const now = Date.now()
  const hit = store.get(url)
  if (hit && hit.expires > now) return hit.value as T

  const existing = inflight.get(url)
  if (existing) return existing as Promise<T>

  const promise = fetch(url)
    .then(async (res) => {
      const data = await res.json()
      if (res.ok) store.set(url, { value: data, expires: Date.now() + ttlMs })
      return data
    })
    .finally(() => inflight.delete(url))

  inflight.set(url, promise)
  return promise
}

/** Drop cached entries. With no prefix, clears everything. */
export function invalidateClientCache(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
}
