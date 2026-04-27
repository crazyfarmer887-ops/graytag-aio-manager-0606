import { afterEach, describe, expect, test, vi } from 'vitest';
import { __resetAdminAuthFetchPatchForTests, installAdminAuthFetchPatch, setAdminToken } from '../src/web/lib/admin-auth';

function setupBrowser() {
  const store = new Map<string, string>();
  const listeners: Record<string, Function[]> = {};
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('window', {
    location: { origin: 'https://email-verify.xyz' },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    fetch: fetchMock,
    alert: vi.fn(),
    dispatchEvent: vi.fn((event: Event) => {
      for (const listener of listeners[event.type] || []) listener(event);
      return true;
    }),
    addEventListener: vi.fn((name: string, listener: Function) => {
      listeners[name] = [...(listeners[name] || []), listener];
    }),
    removeEventListener: vi.fn(),
  } as any);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('admin auth fetch patch', () => {
  afterEach(() => {
    __resetAdminAuthFetchPatchForTests();
    vi.unstubAllGlobals();
  });

  test('adds admin token to profile audit GET requests', async () => {
    const fetchMock = setupBrowser();
    setAdminToken('safe-token');
    installAdminAuthFetchPatch();

    await (window.fetch as any)('/api/profile-audit/results');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('x-admin-token')).toBe('safe-token');
  });

  test('normalizes pasted admin token before using it as a request header', async () => {
    const fetchMock = setupBrowser();
    setAdminToken(' safe\n-token\r ');
    installAdminAuthFetchPatch();

    await (window.fetch as any)('/api/profile-audit/run', { method: 'POST' });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('x-admin-token')).toBe('safe-token');
  });
});
