export class MemoryCache {
  private cache = new Map<string, { data: unknown; timestamp: number }>();
  private _stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  readonly maxSize: number;
  readonly timeout: number;

  constructor(maxSize = 100, timeoutMinutes = 5) {
    this.maxSize = maxSize;
    this.timeout = timeoutMinutes * 60 * 1000;
  }

  get stats() {
    return this._stats;
  }

  get size() {
    return this.cache.size;
  }

  getCacheKey(...parts: unknown[]): string {
    return parts.map(String).join(':');
  }

  get<T = unknown>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this._stats.misses++;
      return null;
    }
    if (Date.now() - entry.timestamp > this.timeout) {
      this.cache.delete(key);
      this._stats.misses++;
      return null;
    }
    this._stats.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  set(key: string, data: unknown): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this._stats.evictions++;
      }
    }
    this.cache.set(key, { data, timestamp: Date.now() });
    this._stats.sets++;
  }

  clear(): number {
    const count = this.cache.size;
    this.cache.clear();
    return count;
  }

  cleanExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.timeout) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}
