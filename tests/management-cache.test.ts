import { describe, expect, test, vi } from 'vitest';
import { createStaleWhileRevalidateCache } from '../src/api/management-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createStaleWhileRevalidateCache', () => {
  test('serves fresh cache hits without calling the slow loader again', async () => {
    let now = 1_000;
    const loadFresh = vi.fn(async () => ({ totalAccounts: 35 }));
    const cache = createStaleWhileRevalidateCache<{ totalAccounts: number }>({ ttlMs: 30_000, now: () => now });

    const first = await cache.get('auto-session', loadFresh);
    now += 1_000;
    const second = await cache.get('auto-session', loadFresh);

    expect(first.cacheStatus).toBe('miss');
    expect(second.cacheStatus).toBe('hit');
    expect(second.data).toEqual({ totalAccounts: 35 });
    expect(loadFresh).toHaveBeenCalledTimes(1);
  });

  test('serves stale data immediately while one background refresh runs', async () => {
    let now = 1_000;
    const refresh = deferred<{ totalAccounts: number }>();
    const loadFresh = vi
      .fn<() => Promise<{ totalAccounts: number }>>()
      .mockResolvedValueOnce({ totalAccounts: 35 })
      .mockReturnValueOnce(refresh.promise);
    const cache = createStaleWhileRevalidateCache<{ totalAccounts: number }>({ ttlMs: 30_000, now: () => now });

    await cache.get('auto-session', loadFresh);
    now += 31_000;

    const stale = await cache.get('auto-session', loadFresh);
    const duplicateStale = await cache.get('auto-session', loadFresh);

    expect(stale.cacheStatus).toBe('stale');
    expect(stale.data).toEqual({ totalAccounts: 35 });
    expect(duplicateStale.cacheStatus).toBe('stale');
    expect(loadFresh).toHaveBeenCalledTimes(2);

    refresh.resolve({ totalAccounts: 36 });
    await refresh.promise;
    await vi.waitFor(() => expect(cache.peek('auto-session')?.data).toEqual({ totalAccounts: 36 }));
  });

  test('force refresh waits for fresh data and updates the cache', async () => {
    let now = 1_000;
    const loadFresh = vi
      .fn<() => Promise<{ totalAccounts: number }>>()
      .mockResolvedValueOnce({ totalAccounts: 35 })
      .mockResolvedValueOnce({ totalAccounts: 37 });
    const cache = createStaleWhileRevalidateCache<{ totalAccounts: number }>({ ttlMs: 30_000, now: () => now });

    await cache.get('auto-session', loadFresh);
    const forced = await cache.get('auto-session', loadFresh, { forceRefresh: true });

    expect(forced.cacheStatus).toBe('refresh');
    expect(forced.data).toEqual({ totalAccounts: 37 });
    expect(loadFresh).toHaveBeenCalledTimes(2);
  });
});
