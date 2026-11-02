/**
 * Generic Expiring LRU Cache with maximum capacity and TTL eviction.
 * Evicts the least-recently-used item when capacity is reached.
 */
export class ExpiringLRUCache {
  constructor({ maxSize = 100, ttlMs = 30 * 60 * 1000 } = {}) {
    this.maxSize = Math.max(1, maxSize);
    this.ttlMs = Math.max(1, ttlMs);
    this.cache = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;

    const entry = this.cache.get(key);
    const now = Date.now();

    if (entry.expiresAt && now > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete & re-set places key at the end of Map iterator)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, customTtlMs) {
    const ttl = typeof customTtlMs === "number" ? customTtlMs : this.ttlMs;
    const expiresAt = ttl > 0 ? Date.now() + ttl : null;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else {
      // Purge any already expired keys first
      this._purgeExpired();

      // If still at capacity, evict the oldest entry (first key in Map)
      if (this.cache.size >= this.maxSize) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) {
          this.cache.delete(oldestKey);
        }
      }
    }

    this.cache.set(key, { value, expiresAt });
    return this;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    this._purgeExpired();
    return this.cache.size;
  }

  _purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}
