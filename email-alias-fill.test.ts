import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
const originalToken = process.env.AIO_ADMIN_TOKEN;
const originalPinStore = process.env.EMAIL_ALIAS_PIN_STORE_PATH;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'email-alias-fill-'));
  process.env.EMAIL_ALIAS_PIN_STORE_PATH = join(tempDir, 'alias-pins.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalToken;
  if (originalPinStore === undefined) delete process.env.EMAIL_ALIAS_PIN_STORE_PATH;
  else process.env.EMAIL_ALIAS_PIN_STORE_PATH = originalPinStore;
});

describe('email alias fill lookup', () => {
  it('matches account email to SimpleLogin alias id and PIN', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '101': { pin: '2468', updatedAt: '2026-04-26T00:00:00Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'disney6.darkened459@aleeas.com',
      serviceType: '디즈니플러스',
      aliases: [
        { id: 101, email: 'disney6.darkened459@aleeas.com', enabled: true },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      found: true,
      email: 'disney6.darkened459@aleeas.com',
      emailId: 101,
      pin: '2468',
      missing: [],
    });
    expect(result.memo).toContain('https://email-verify.xyz/email/mail/101');
    expect(result.memo).toContain('2468');
  });

  it('reports missing alias and PIN without placeholders when no data exists', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({}), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'missing@example.com',
      serviceType: '디즈니플러스',
      aliases: [],
    });

    expect(result.ok).toBe(false);
    expect(result.found).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['email', 'pin']));
    expect(result.memo).toBe('');
  });

  it('protects /api/email-alias-fill with admin token and returns lookup result', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '202': { pin: '1357', updatedAt: '2026-04-26T00:00:00Z' },
    }), 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      aliases: [{ id: 202, email: 'netflix1.foo@example.com', enabled: true }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const app = (await import('./src/api/index.ts')).default;

    const forbidden = await app.request('/api/email-alias-fill?email=netflix1.foo%40example.com&serviceType=넷플릭스');
    expect(forbidden.status).toBe(403);

    const allowed = await app.request('/api/email-alias-fill?email=netflix1.foo%40example.com&serviceType=넷플릭스', {
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as any;
    expect(body).toMatchObject({ ok: true, found: true, emailId: 202, pin: '1357' });
  });
});
