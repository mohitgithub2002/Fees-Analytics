/**
 * Lightweight in-memory read-through cache with TTL + tag invalidation.
 *
 * Used to serve the expensive v2 read endpoints (analytics, student lists,
 * reference data) without recomputing their SQL aggregations on every
 * request. Mutations call `invalidateTags(...)` so cached data is never
 * stale after a write — the TTL is only a safety expiry.
 *
 * The store lives on globalThis so it survives dev hot-reloads and is shared
 * across requests handled by the same (warm) server instance. On serverless
 * it is per-instance, which still eliminates repeated work within an
 * instance's lifetime; the client cache handles cross-navigation dedupe.
 */

interface Entry {
  value: unknown
  expires: number
  tags: string[]
}

const MAX_ENTRIES = 500

const store: Map<string, Entry> =
  (globalThis as typeof globalThis & { __feeCache?: Map<string, Entry> }).__feeCache ??
  new Map<string, Entry>()
const pending: Map<string, Promise<unknown>> =
  (globalThis as typeof globalThis & { __feePending?: Map<string, Promise<unknown>> }).__feePending ??
  new Map<string, Promise<unknown>>()

;(globalThis as typeof globalThis & { __feeCache?: Map<string, Entry> }).__feeCache = store
;(globalThis as typeof globalThis & { __feePending?: Map<string, Promise<unknown>> }).__feePending =
  pending

/**
 * Return the cached value for `key`, or compute it with `fn` and cache it.
 * Concurrent misses for the same key share a single in-flight computation.
 */
export async function cached<T>(
  key: string,
  opts: { tags: string[]; ttlMs: number },
  fn: () => Promise<T>
): Promise<T> {
  const now = Date.now()
  const existing = store.get(key)
  if (existing && existing.expires > now) return existing.value as T

  const inFlight = pending.get(key)
  if (inFlight) return inFlight as Promise<T>

  const promise = (async () => {
    try {
      const value = await fn()
      if (store.size >= MAX_ENTRIES) {
        // Evict the oldest inserted entry (Map preserves insertion order).
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
      store.set(key, { value, expires: Date.now() + opts.ttlMs, tags: opts.tags })
      return value
    } finally {
      pending.delete(key)
    }
  })()

  pending.set(key, promise)
  return promise
}

/** Drop every cached entry carrying any of the given tags. */
export function invalidateTags(...tags: string[]): void {
  if (tags.length === 0) return
  const set = new Set(tags)
  for (const [key, entry] of store) {
    if (entry.tags.some((t) => set.has(t))) store.delete(key)
  }
}

/** Test/debug helper: clear the entire cache. */
export function clearCache(): void {
  store.clear()
  pending.clear()
}

/**
 * Cache tags. `fees` covers everything derived from money movement
 * (analytics + student due lists); reference tags cover their own tables.
 *
 * `recovery` is separate from `fees` because it is invalidated by things that
 * move no money at all — a logged call, a promise, an economic-tier tag — and
 * conflating the two would drop the expensive fee aggregations every time
 * somebody noted down a phone call.
 */
export const TAGS = {
  fees: 'fees',
  sessions: 'sessions',
  classes: 'classes',
  classrooms: 'classrooms',
  structures: 'structures',
  recovery: 'recovery',
} as const
