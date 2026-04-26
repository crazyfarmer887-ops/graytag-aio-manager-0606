import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PRICE_SAFETY_CONFIG,
  assertPriceChangeAllowed,
  previewPriceChange,
  recordSuccessfulPriceDecrease,
  savePriceSafetyConfig,
} from './src/api/price-safety.ts';

let tempDir: string;
const originalToken = process.env.AIO_ADMIN_TOKEN;
const originalConfigPath = process.env.PRICE_SAFETY_PATH;
const originalEventsPath = process.env.PRICE_SAFETY_EVENTS_PATH;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'price-safety-'));
  process.env.PRICE_SAFETY_PATH = join(tempDir, 'price-safety.json');
  process.env.PRICE_SAFETY_EVENTS_PATH = join(tempDir, 'price-safety-events.json');
  savePriceSafetyConfig(DEFAULT_PRICE_SAFETY_CONFIG);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalToken;
  if (originalConfigPath === undefined) delete process.env.PRICE_SAFETY_PATH;
  else process.env.PRICE_SAFETY_PATH = originalConfigPath;
  if (originalEventsPath === undefined) delete process.env.PRICE_SAFETY_EVENTS_PATH;
  else process.env.PRICE_SAFETY_EVENTS_PATH = originalEventsPath;
});

describe('price safety preview', () => {
  it('allows safe price changes and reports delta', () => {
    const preview = previewPriceChange({ productId: 'p1', title: '넷플릭스', currentPrice: 5000, nextPrice: 4500 });

    expect(preview).toMatchObject({ allowed: true, delta: -500, blockedReasons: [] });
  });

  it('blocks min price, one-shot decrease, excluded products, and daily decrease limit', () => {
    savePriceSafetyConfig({ enabled: true, minPrice: 1000, maxDecreaseOnce: 1000, maxDailyDecreaseCount: 1, excludedProductIds: ['excluded'] });

    expect(previewPriceChange({ productId: 'p1', currentPrice: 2500, nextPrice: 900 }).blockedReasons.join('\n')).toContain('최소 가격');
    expect(previewPriceChange({ productId: 'p1', currentPrice: 3000, nextPrice: 1500 }).blockedReasons.join('\n')).toContain('1회 최대 인하폭');
    expect(previewPriceChange({ productId: 'excluded', currentPrice: 3000, nextPrice: 2500 }).blockedReasons.join('\n')).toContain('제외 상품');

    expect(assertPriceChangeAllowed({ productId: 'daily', currentPrice: 3000, nextPrice: 2500 }).allowed).toBe(true);
    expect(previewPriceChange({ productId: 'daily', currentPrice: 2500, nextPrice: 2200 }).allowed).toBe(true);
    recordSuccessfulPriceDecrease({ productId: 'daily', currentPrice: 3000, nextPrice: 2500 });
    const second = previewPriceChange({ productId: 'daily', currentPrice: 2500, nextPrice: 2200 });
    expect(second.allowed).toBe(false);
    expect(second.blockedReasons.join('\n')).toContain('일일 가격 인하 횟수');
  });
});

describe('price safety API and update-price guard', () => {
  async function importFreshApi() {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/lender/product/setting')) {
        return new Response('<input id="name" value="테스트"><input class="price-input" value="5000">', { status: 200 });
      }
      return new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    return (await import('./src/api/index.ts')).default;
  }

  it('exposes config and preview APIs with admin protection for writes', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    const apiApp = await importFreshApi();

    const getRes = await apiApp.request('/price-safety', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({ enabled: true, minPrice: 1000 });

    const forbidden = await apiApp.request('/price-safety', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(forbidden.status).toBe(403);

    const previewRes = await apiApp.request('/price-safety/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ productId: 'p1', currentPrice: 3000, nextPrice: 2500 }),
    });
    expect(previewRes.status).toBe(200);
    await expect(previewRes.json()).resolves.toMatchObject({ allowed: true, delta: -500 });
  });

  it('blocks /my/update-price before calling graytag update when safety denies the change', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    savePriceSafetyConfig({ enabled: true, minPrice: 1000, maxDecreaseOnce: 1000, maxDailyDecreaseCount: 3, excludedProductIds: [] });
    const apiApp = await importFreshApi();
    const fetchMock = vi.mocked(globalThis.fetch);

    const res = await apiApp.request('/my/update-price', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({
        JSESSIONID: 'session',
        products: [{ usid: 'p1', currentPrice: 5000, price: 3500 }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results[0]).toMatchObject({ usid: 'p1', ok: false });
    expect(body.results[0].blockedReasons.join('\n')).toContain('1회 최대 인하폭');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/ws/lender/updateProductInfo'))).toBe(false);
  });
});
