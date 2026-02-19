import fs from 'fs';
import path from 'path';

// NCBI rate limits
const RATE_WITH_KEY = 100;      // ~10 req/sec with API key
const RATE_WITHOUT_KEY = 334;   // ~3 req/sec without API key

const KEY_COOLDOWN_MS = 60 * 1000;           // 1 minute cooldown after failures
const MAX_FAILURES_BEFORE_UNHEALTHY = 3;

export class ApiKeyPool {
    constructor() {
        this.keys = [];
        this.strategy = 'round-robin';
        this.currentIndex = 0;
        this.keyHealth = new Map(); // apiKey -> { failures, lastFailure, healthy }
        this._loadKeys();
    }

    _loadKeys() {
        // Priority 1: JSON config file
        const configPaths = [
            path.join(process.cwd(), 'api-keys.json'),
            path.join(process.cwd(), 'config', 'api-keys.json')
        ];

        for (const configPath of configPaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    if (config.keys && Array.isArray(config.keys) && config.keys.length > 0) {
                        this.keys = config.keys.map(k => ({
                            apiKey: k.api_key,
                            email: k.email
                        }));
                        this.strategy = config.strategy || 'round-robin';
                        console.error(`[ApiKeyPool] Loaded ${this.keys.length} keys from ${configPath} (strategy: ${this.strategy})`);

                        for (const key of this.keys) {
                            this.keyHealth.set(key.apiKey, {
                                failures: 0,
                                lastFailure: 0,
                                healthy: true
                            });
                        }
                        return;
                    }
                } catch (error) {
                    console.error(`[ApiKeyPool] Error reading ${configPath}:`, error.message);
                }
            }
        }

        // Priority 2: Single ENV var (backward compatible)
        if (process.env.PUBMED_API_KEY) {
            this.keys = [{
                apiKey: process.env.PUBMED_API_KEY,
                email: process.env.PUBMED_EMAIL || 'user@example.com'
            }];
            this.strategy = 'single';
            this.keyHealth.set(process.env.PUBMED_API_KEY, {
                failures: 0, lastFailure: 0, healthy: true
            });
            console.error(`[ApiKeyPool] Using single key from PUBMED_API_KEY env var`);
            return;
        }

        // Priority 3: No key (anonymous mode)
        this.keys = [];
        this.strategy = 'none';
        console.error(`[ApiKeyPool] No API keys configured. Running in anonymous mode (3 req/sec limit)`);
    }

    /**
     * Get the next available key based on strategy.
     * Returns { apiKey, email } or null if no keys available.
     */
    getKey() {
        if (this.keys.length === 0) return null;

        this._recoverKeys();

        const healthyKeys = this.keys.filter(k => {
            const health = this.keyHealth.get(k.apiKey);
            return health && health.healthy;
        });

        if (healthyKeys.length === 0) {
            console.error(`[ApiKeyPool] All keys unhealthy, attempting recovery`);
            this._forceRecoverOldest();
            const recovered = this.keys.filter(k => this.keyHealth.get(k.apiKey)?.healthy);
            if (recovered.length === 0) return null;
            return recovered[0];
        }

        switch (this.strategy) {
            case 'round-robin': {
                const key = healthyKeys[this.currentIndex % healthyKeys.length];
                this.currentIndex = (this.currentIndex + 1) % healthyKeys.length;
                return key;
            }
            case 'failover':
                return healthyKeys[0];
            case 'random':
                return healthyKeys[Math.floor(Math.random() * healthyKeys.length)];
            case 'single':
                return healthyKeys[0] || null;
            default:
                return healthyKeys[0] || null;
        }
    }

    /**
     * Report a successful request for a key.
     */
    reportSuccess(apiKey) {
        const health = this.keyHealth.get(apiKey);
        if (health) {
            health.failures = 0;
            health.healthy = true;
        }
    }

    /**
     * Report a failed request for a key.
     */
    reportFailure(apiKey) {
        const health = this.keyHealth.get(apiKey);
        if (health) {
            health.failures++;
            health.lastFailure = Date.now();
            if (health.failures >= MAX_FAILURES_BEFORE_UNHEALTHY) {
                health.healthy = false;
                console.error(`[ApiKeyPool] Key ${apiKey.substring(0, 8)}... marked unhealthy after ${health.failures} failures`);
            }
        }
    }

    /**
     * Get the appropriate rate limit delay based on current key availability.
     */
    getRateLimitDelay() {
        const hasHealthyKey = this.keys.length > 0 && this.keys.some(k => this.keyHealth.get(k.apiKey)?.healthy);
        return hasHealthyKey ? RATE_WITH_KEY : RATE_WITHOUT_KEY;
    }

    /**
     * Recover keys whose cooldown period has elapsed.
     */
    _recoverKeys() {
        const now = Date.now();
        for (const [apiKey, health] of this.keyHealth.entries()) {
            if (!health.healthy && (now - health.lastFailure) > KEY_COOLDOWN_MS) {
                health.healthy = true;
                health.failures = 0;
                console.error(`[ApiKeyPool] Key ${apiKey.substring(0, 8)}... recovered after cooldown`);
            }
        }
    }

    _forceRecoverOldest() {
        let oldestTime = Infinity;
        let oldestKey = null;
        for (const [apiKey, health] of this.keyHealth.entries()) {
            if (health.lastFailure < oldestTime) {
                oldestTime = health.lastFailure;
                oldestKey = apiKey;
            }
        }
        if (oldestKey) {
            const health = this.keyHealth.get(oldestKey);
            health.healthy = true;
            health.failures = 0;
        }
    }

    /**
     * Get pool status for diagnostics.
     */
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
                failures: this.keyHealth.get(k.apiKey)?.failures ?? 0
            }))
        };
    }
}
