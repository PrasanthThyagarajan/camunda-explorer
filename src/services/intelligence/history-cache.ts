/**
 * History Cache — simple TTL-based in-memory cache layer.
 *
 * Prevents repeated heavy Camunda API calls when the same data is
 * requested within a short window (diagnosis + signals + intelligence
 * all query the same underlying history tables).
 *
 * Eviction: TTL-based with a hard cap on total entries to prevent
 * memory bloat in long-running dashboard processes.
 */

import { logger } from "../../utils/logger.js";

// ── Configuration ───────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200; // hard cap — evict oldest when exceeded

// ── Cache Entry ─────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  createdAt: number;
  ttl: number;
}

// ── The Cache ───────────────────────────────────────────────────

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Get a cached value, or null if expired / missing.
 */
export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > entry.ttl) {
    store.delete(key);
    return null;
  }

  return entry.data as T;
}

/**
 * Store a value in the cache with a TTL.
 */
export function cacheSet<T>(key: string, data: T, ttl = DEFAULT_TTL_MS): void {
  // Enforce max entries by evicting oldest
  if (store.size >= MAX_ENTRIES) {
    let oldestKey = "";
    let oldestTs = Infinity;
    for (const [k, v] of store) {
      if (v.createdAt < oldestTs) {
        oldestTs = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }

  store.set(key, { data, createdAt: Date.now(), ttl });
}

/**
 * Invalidate a specific cache key.
 */
export function cacheInvalidate(key: string): void {
  store.delete(key);
}

/**
 * Invalidate all keys matching a prefix (e.g. "exec::" or "bpmn::").
 */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Get cache stats for monitoring.
 */
export function cacheStats(): { size: number; maxEntries: number } {
  return { size: store.size, maxEntries: MAX_ENTRIES };
}
