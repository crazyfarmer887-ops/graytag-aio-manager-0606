import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
const originalAuditPath = process.env.AUDIT_LOG_PATH;
const originalToken = process.env.AIO_ADMIN_TOKEN;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'aio-audit-log-'));
  process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.jsonl');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalAuditPath === undefined) delete process.env.AUDIT_LOG_PATH;
  else process.env.AUDIT_LOG_PATH = originalAuditPath;
  if (originalToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalToken;
});

describe('audit log module', () => {
  it('masks sensitive values recursively before append/read', async () => {
    const { appendAuditLog, readAuditLog, maskSensitive } = await import('./src/api/audit-log.ts');

    const masked = maskSensitive({
      Authorization: 'Bearer secret-token',
      cookie: 'JSESSIONID=abc123; AWSALB=alb-secret',
      nested: { pin: '123456', oauthToken: 'oauth-secret', keepPasswd: 'pw-secret', safe: 'ok' },
    });

    expect(JSON.stringify(masked)).not.toContain('secret-token');
    expect(JSON.stringify(masked)).not.toContain('abc123');
    expect(JSON.stringify(masked)).not.toContain('123456');
    expect(masked.nested.safe).toBe('ok');

    appendAuditLog({
      actor: 'admin',
      action: 'test.mask',
      targetType: 'test',
      targetId: 't1',
      summary: 'mask test',
      result: 'success',
      requestId: 'req-1',
      details: masked,
    });

    const entries = readAuditLog();
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).not.toContain('secret-token');
    expect(JSON.stringify(entries[0])).not.toContain('abc123');
    expect(entries[0]).toMatchObject({ actor: 'admin', action: 'test.mask', result: 'success' });
    expect(entries[0].timestamp).toEqual(expect.any(String));
  });

  it('reads most recent entries first and enforces limits', async () => {
    const { appendAuditLog, readAuditLog } = await import('./src/api/audit-log.ts');

    for (let i = 1; i <= 5; i++) {
      appendAuditLog({
        actor: 'system',
        action: 'test.order',
        targetType: 'item',
        targetId: String(i),
        summary: `entry ${i}`,
        result: 'success',
        requestId: `req-${i}`,
      });
    }

    expect(readAuditLog({ limit: 3 }).map((entry) => entry.targetId)).toEqual(['5', '4', '3']);
    expect(readAuditLog({ limit: 500 })).toHaveLength(5);
  });
});

describe('audit log API and route recording', () => {
  async function importFreshApi(fetchImpl?: typeof fetch) {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(fetchImpl ?? (async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } }))));
    return (await import('./src/api/index.ts')).default;
  }

  it('protects GET /api/audit-log with admin auth', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    const apiApp = await importFreshApi();

    await expect(apiApp.request('/api/audit-log')).resolves.toHaveProperty('status', 403);
    const res = await apiApp.request('/api/audit-log?limit=10', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ entries: expect.any(Array), limit: 10 });
  });

  it('records blocked /my/update-price attempts without leaking JSESSIONID', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    const { savePriceSafetyConfig } = await import('./src/api/price-safety.ts');
    savePriceSafetyConfig({ enabled: true, minPrice: 1000, maxDecreaseOnce: 1000, maxDailyDecreaseCount: 3, excludedProductIds: [] });
    const apiApp = await importFreshApi();

    const res = await apiApp.request('/my/update-price', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({
        JSESSIONID: 'super-secret-session',
        Authorization: 'Bearer should-not-log',
        products: [{ usid: 'p1', currentPrice: 5000, price: 3500 }],
      }),
    });
    expect(res.status).toBe(200);

    const auditRes = await apiApp.request('/api/audit-log?limit=1', { headers: { 'x-admin-token': 'test-admin-token' } });
    const body = await auditRes.json() as any;
    expect(body.entries[0]).toMatchObject({ action: 'my.update-price', result: 'blocked', targetType: 'product' });
    const serialized = JSON.stringify(body.entries[0]);
    expect(serialized).not.toContain('super-secret-session');
    expect(serialized).not.toContain('should-not-log');
  });
});
