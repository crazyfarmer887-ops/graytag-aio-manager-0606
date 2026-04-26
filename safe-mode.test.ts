import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SAFE_MODE_CONFIG, loadSafeModeConfig, saveSafeModeConfig } from './src/api/safe-mode.ts';

let tempDir: string;
const originalToken = process.env.AIO_ADMIN_TOKEN;
const originalSafeModePath = process.env.SAFE_MODE_PATH;
const originalAuditLogPath = process.env.AUDIT_LOG_PATH;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'safe-mode-'));
  process.env.SAFE_MODE_PATH = join(tempDir, 'safe-mode.json');
  process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.jsonl');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalToken;
  if (originalSafeModePath === undefined) delete process.env.SAFE_MODE_PATH;
  else process.env.SAFE_MODE_PATH = originalSafeModePath;
  if (originalAuditLogPath === undefined) delete process.env.AUDIT_LOG_PATH;
  else process.env.AUDIT_LOG_PATH = originalAuditLogPath;
});

describe('safe mode config', () => {
  it('defaults to disabled', () => {
    expect(loadSafeModeConfig()).toMatchObject({ enabled: false, reason: '', updatedBy: 'system' });
    expect(DEFAULT_SAFE_MODE_CONFIG.enabled).toBe(false);
  });

  it('persists normalized updates', () => {
    const saved = saveSafeModeConfig({ enabled: true, reason: '점검', updatedBy: 'admin-user' });
    expect(saved).toMatchObject({ enabled: true, reason: '점검', updatedBy: 'admin-user' });
    expect(saved.updatedAt).toMatch(/T/);
    expect(loadSafeModeConfig()).toEqual(saved);
  });
});

describe('safe mode API and route locking', () => {
  async function importFreshApi() {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } })));
    return (await import('./src/api/index.ts')).default;
  }

  it('protects read/update API with admin auth and audits updates', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    const apiApp = await importFreshApi();

    const noAuthGet = await apiApp.request('/safe-mode');
    expect(noAuthGet.status).toBe(403);

    const getRes = await apiApp.request('/safe-mode', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({ enabled: false, reason: '' });

    const forbiddenPost = await apiApp.request('/safe-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, reason: 'no auth' }),
    });
    expect(forbiddenPost.status).toBe(403);

    const updateRes = await apiApp.request('/api/safe-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ enabled: true, reason: 'maintenance', updatedBy: 'ops' }),
    });
    expect(updateRes.status).toBe(200);
    await expect(updateRes.json()).resolves.toMatchObject({ enabled: true, reason: 'maintenance', updatedBy: 'ops' });

    const auditRes = await apiApp.request('/audit-log?limit=5', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(auditRes.status).toBe(200);
    const audit = await auditRes.json() as any;
    expect(audit.entries.some((entry: any) => entry.action === 'safe-mode.update' && entry.result === 'success')).toBe(true);
  });

  it('returns 423 for dangerous writes when enabled while GET/read routes continue', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    saveSafeModeConfig({ enabled: true, reason: 'incident', updatedBy: 'test' });
    const apiApp = await importFreshApi();
    const fetchMock = vi.mocked(globalThis.fetch);

    const pingRes = await apiApp.request('/ping');
    expect(pingRes.status).not.toBe(423);

    const readRes = await apiApp.request('/safe-mode', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(readRes.status).toBe(200);

    for (const path of ['/my/update-price', '/api/my/delete-products', '/auto-undercutter/run', '/chat/send']) {
      const res = await apiApp.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
        body: JSON.stringify({ JSESSIONID: 'secret-session', products: [{ usid: 'p1', price: 1000 }], message: 'hello' }),
      });
      expect(res.status, path).toBe(423);
      await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'SAFE_MODE_ENABLED' });
    }

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('graytag.co.kr'))).toBe(false);

    const auditRes = await apiApp.request('/audit-log?limit=20', { headers: { 'x-admin-token': 'test-admin-token' } });
    const audit = await auditRes.json() as any;
    expect(audit.entries.filter((entry: any) => entry.action === 'safe-mode.blocked').length).toBeGreaterThanOrEqual(4);
  });
});
