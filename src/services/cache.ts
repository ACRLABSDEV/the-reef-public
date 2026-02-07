/**
 * Simple in-memory cache with TTL
 * 
 * Upgrade path to Redis:
 * - Set REDIS_URL env var
 * - Swap implementation to ioredis
 * - Same interface, just change the backend
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Get cached value or null if expired/missing
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Set value with TTL in seconds
   */
  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlSeconds * 1000),
    });
  }

  /**
   * Delete specific key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get or set pattern - returns cached value or calls getter and caches result
   */
  async getOrSet<T>(key: string, ttlSeconds: number, getter: () => T | Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await getter();
    this.set(key, data, ttlSeconds);
    return data;
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache stats
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
  }
}

// Singleton instance
export const cache = new MemoryCache();

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  WORLD_STATE: 5,      // /world - updates frequently
  DISCOVER: 10,        // /world/discover - semi-static
  EVENTS: 3,           // /world/events - very dynamic
  BOSS: 2,             // /world/boss - real-time during fights
  ARENA: 3,            // /world/arena - active during duels
  TREASURY: 30,        // /world/treasury - changes slowly
  SHOP: 60,            // /world/shop - static
  PREDICTIONS: 5,      // /world/predictions - semi-dynamic
  LORE: 300,           // /world/lore - static
  AGENTS: 5,           // /world/agents - updates with movement
} as const;

// Cache key helpers
export const CACHE_KEYS = {
  world: () => 'world:state',
  discover: () => 'world:discover',
  events: (limit: number) => `world:events:${limit}`,
  boss: () => 'world:boss',
  arena: () => 'world:arena',
  treasury: () => 'world:treasury',
  shop: () => 'world:shop',
  predictions: () => 'world:predictions',
  lore: () => 'world:lore',
  agents: (zone?: string) => zone ? `world:agents:${zone}` : 'world:agents:all',
} as const;
