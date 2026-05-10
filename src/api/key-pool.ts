import fs from 'fs';
import path from 'path';

const RATE_WITH_KEY = 100;
const RATE_WITHOUT_KEY = 334;
const KEY_COOLDOWN_MS = 60_000;
const MAX_FAILURES = 3;

interface KeyEntry {
  apiKey: string;
  email: string;
}

interface KeyHealth {
  failures: number;
  lastFailure: number;
  healthy: boolean;
}

export class ApiKeyPool {
  private keys: KeyEntry[] = [];
  private strategy = 'round-robin';
  private currentIndex = 0;
  private keyHealth = new Map<string, KeyHealth>();

  constructor() {
    this.loadKeys();
  }

  private loadKeys(): void {
    const configPaths = [
      path.join(process.cwd(), 'api-keys.json'),
      path.join(process.cwd(), 'config', 'api-keys.json'),
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (config.keys?.length > 0) {
            this.keys = config.keys.map((k: { api_key: string; email: string }) => ({
              apiKey: k.api_key,
              email: k.email,
            }));
            this.strategy = config.strategy || 'round-robin';
            for (const key of this.keys) {
              this.keyHealth.set(key.apiKey, { failures: 0, lastFailure: 0, healthy: true });
            }
            console.error(`[ApiKeyPool] Loaded ${this.keys.length} keys from ${configPath} (${this.strategy})`);
            return;
          }
        } catch (error) {
          console.error(`[ApiKeyPool] Error reading ${configPath}:`, (error as Error).message);
        }
      }
    }

    if (process.env.PUBMED_API_KEY) {
      this.keys = [{ apiKey: process.env.PUBMED_API_KEY, email: process.env.PUBMED_EMAIL || 'user@example.com' }];
      this.strategy = 'single';
      this.keyHealth.set(process.env.PUBMED_API_KEY, { failures: 0, lastFailure: 0, healthy: true });
      console.error('[ApiKeyPool] Using single key from env');
      return;
    }

    this.keys = [];
    this.strategy = 'none';
    console.error('[ApiKeyPool] No API keys — anonymous mode (3 req/sec)');
  }

  getKey(): KeyEntry | null {
    if (this.keys.length === 0) return null;
    this.recoverKeys();

    const healthy = this.keys.filter(k => this.keyHealth.get(k.apiKey)?.healthy);
    if (healthy.length === 0) {
      this.forceRecoverOldest();
      const recovered = this.keys.filter(k => this.keyHealth.get(k.apiKey)?.healthy);
      return recovered[0] || null;
    }

    switch (this.strategy) {
      case 'round-robin': {
        const key = healthy[this.currentIndex % healthy.length];
        this.currentIndex = (this.currentIndex + 1) % healthy.length;
        return key;
      }
      case 'random':
        return healthy[Math.floor(Math.random() * healthy.length)];
      default:
        return healthy[0] || null;
    }
  }

  reportSuccess(apiKey: string): void {
    const h = this.keyHealth.get(apiKey);
    if (h) { h.failures = 0; h.healthy = true; }
  }

  reportFailure(apiKey: string): void {
    const h = this.keyHealth.get(apiKey);
    if (h) {
      h.failures++;
      h.lastFailure = Date.now();
      if (h.failures >= MAX_FAILURES) {
        h.healthy = false;
        console.error(`[ApiKeyPool] Key ${apiKey.substring(0, 8)}... marked unhealthy`);
      }
    }
  }

  getRateLimitDelay(): number {
    const hasHealthy = this.keys.some(k => this.keyHealth.get(k.apiKey)?.healthy);
    return hasHealthy ? RATE_WITH_KEY : RATE_WITHOUT_KEY;
  }

  getStatus() {
    return {
      totalKeys: this.keys.length,
      strategy: this.strategy,
      healthyKeys: this.keys.filter(k => this.keyHealth.get(k.apiKey)?.healthy).length,
      unhealthyKeys: this.keys.filter(k => !this.keyHealth.get(k.apiKey)?.healthy).length,
      rateLimitDelay: this.getRateLimitDelay(),
      keys: this.keys.map(k => ({
        keyPrefix: k.apiKey.substring(0, 8) + '...',
        email: k.email,
        healthy: this.keyHealth.get(k.apiKey)?.healthy ?? false,
        failures: this.keyHealth.get(k.apiKey)?.failures ?? 0,
      })),
    };
  }

  private recoverKeys(): void {
    const now = Date.now();
    for (const [, h] of this.keyHealth) {
      if (!h.healthy && (now - h.lastFailure) > KEY_COOLDOWN_MS) {
        h.healthy = true;
        h.failures = 0;
      }
    }
  }

  private forceRecoverOldest(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [key, h] of this.keyHealth) {
      if (h.lastFailure < oldestTime) {
        oldestTime = h.lastFailure;
        oldest = key;
      }
    }
    if (oldest) {
      const h = this.keyHealth.get(oldest)!;
      h.healthy = true;
      h.failures = 0;
    }
  }
}
