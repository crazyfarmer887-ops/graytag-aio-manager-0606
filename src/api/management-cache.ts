export type CacheStatus = 'miss' | 'hit' | 'stale' | 'refresh';

export interface CacheEntry<T> {
  data: T;
  updatedAt: number;
}

export interface CacheResult<T> extends CacheEntry<T> {
  cacheStatus: CacheStatus;
}

export interface StaleWhileRevalidateCacheOptions {
  ttlMs: number;
  now?: () => number;
}

export interface CacheGetOptions {
  forceRefresh?: boolean;
}

export function createStaleWhileRevalidateCache<T>(options: StaleWhileRevalidateCacheOptions) {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<CacheEntry<T>>>();

  const refresh = async (key: string, loadFresh: () => Promise<T>): Promise<CacheEntry<T>> => {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = loadFresh()
      .then((data) => {
        const entry = { data, updatedAt: now() };
        entries.set(key, entry);
        return entry;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  };

  return {
    async get(key: string, loadFresh: () => Promise<T>, getOptions: CacheGetOptions = {}): Promise<CacheResult<T>> {
      const cached = entries.get(key);
      const ageMs = cached ? now() - cached.updatedAt : Number.POSITIVE_INFINITY;

      if (!getOptions.forceRefresh && cached && ageMs < options.ttlMs) {
        return { ...cached, cacheStatus: 'hit' };
      }

      if (!getOptions.forceRefresh && cached) {
        void refresh(key, loadFresh).catch((error) => {
          console.warn('[management-cache] background refresh failed:', error?.message || error);
        });
        return { ...cached, cacheStatus: 'stale' };
      }

      const fresh = await refresh(key, loadFresh);
      return { ...fresh, cacheStatus: getOptions.forceRefresh && cached ? 'refresh' : 'miss' };
    },

    peek(key: string): CacheEntry<T> | undefined {
      return entries.get(key);
    },

    clear(key?: string) {
      if (key) entries.delete(key);
      else entries.clear();
    },
  };
}

export const DEFAULT_MANAGEMENT_CACHE_TTL_MS = 30_000;
export const managementCache = createStaleWhileRevalidateCache<any>({ ttlMs: DEFAULT_MANAGEMENT_CACHE_TTL_MS });

export function isAutoSessionManagementRequest(body: any): boolean {
  return !body?.AWSALB?.trim?.() && !body?.AWSALBCORS?.trim?.() && !body?.JSESSIONID?.trim?.();
}

export function shouldForceManagementRefresh(body: any, queryRefresh?: string | null, cacheControl?: string | null): boolean {
  return body?.forceRefresh === true || queryRefresh === '1' || cacheControl?.toLowerCase().includes('no-cache') === true;
}
