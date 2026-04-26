import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let apiApp: Awaited<typeof import('./src/api/index.ts')>['default'];
const originalToken = process.env.AIO_ADMIN_TOKEN;

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  apiApp = (await import('./src/api/index.ts')).default;
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalToken;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

async function post(path: string, headers: Record<string, string> = {}) {
  return apiApp.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
}

async function apiRequest(method: string, path: string, headers: Record<string, string> = {}) {
  return apiApp.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  });
}

describe('AIO admin auth guard', () => {
  it('keeps public ping available without an admin token configured', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    const res = await apiApp.request('/ping');

    expect(res.status).toBe(200);
  });

  it('fails closed for dangerous APIs when AIO_ADMIN_TOKEN is not configured', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    const res = await post('/post/keepAcct');

    expect(res.status).toBe(503);
  });

  it('rejects dangerous APIs without a valid bearer or x-admin-token', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';

    await expect(post('/post/keepAcct')).resolves.toHaveProperty('status', 403);
    await expect(post('/post/keepAcct', { authorization: 'Bearer wrong' })).resolves.toHaveProperty('status', 403);
  });

  it('allows dangerous APIs with either bearer or x-admin-token auth', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';

    await expect(post('/post/keepAcct', { authorization: 'Bearer test-admin-token' })).resolves.toHaveProperty('status', 400);
    await expect(post('/post/keepAcct', { 'x-admin-token': 'test-admin-token' })).resolves.toHaveProperty('status', 400);
  });

  it('also guards protected routes when the mounted /api prefix is present', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    const res = await post('/api/post/keepAcct');

    expect(res.status).toBe(503);
  });

  it('keeps explicitly public GET API reads available without an admin token configured', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    await expect(apiApp.request('/prices')).resolves.not.toHaveProperty('status', 503);
    await expect(apiApp.request('/api/prices')).resolves.not.toHaveProperty('status', 503);
    await expect(apiApp.request('/api/seller/status')).resolves.toHaveProperty('status', 200);
  });

  it('fails closed for sensitive GET APIs when AIO_ADMIN_TOKEN is not configured', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    await expect(apiApp.request('/session/cookies')).resolves.toHaveProperty('status', 503);
    await expect(apiApp.request('/session/status')).resolves.toHaveProperty('status', 503);
    await expect(apiApp.request('/chat/rooms')).resolves.toHaveProperty('status', 503);
    await expect(apiApp.request('/chat/messages/example-room')).resolves.toHaveProperty('status', 503);
    await expect(apiApp.request('/chat/poll')).resolves.toHaveProperty('status', 503);
    await expect(apiApp.request('/api/session/cookies')).resolves.toHaveProperty('status', 503);
    await expect(apiApp.request('/api/chat/rooms')).resolves.toHaveProperty('status', 503);
  });

  it('allows sensitive GET APIs only with a valid admin token', async () => {
    process.env.AIO_ADMIN_TOKEN='test-admin-token';

    await expect(apiApp.request('/session/cookies')).resolves.toHaveProperty('status', 403);
    await expect(apiApp.request('/session/cookies', { headers: { 'x-admin-token': 'test-admin-token' } })).resolves.not.toHaveProperty('status', 403);
  });

  it('exposes public seller status with the minimum dashboard structure', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    const res = await apiApp.request('/api/seller/status');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: expect.any(Boolean),
      generatedAt: expect.any(String),
      session: {
        ok: expect.any(Boolean),
        status: expect.any(String),
      },
      pollDaemon: expect.objectContaining({
        ok: expect.any(Boolean),
      }),
      undercutter: expect.objectContaining({
        enabled: expect.any(Boolean),
      }),
      autoReply: expect.objectContaining({
        enabled: expect.any(Boolean),
      }),
      data: expect.objectContaining({
        knownDeals: expect.any(Number),
        manualMembers: expect.any(Number),
      }),
      warnings: expect.any(Array),
    });
  });

  it('fails closed for mutating POST APIs that were missing from the old allowlist', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    await expect(post('/session/refresh-kakao')).resolves.toHaveProperty('status', 503);
    await expect(post('/daily-rates')).resolves.toHaveProperty('status', 503);
    await expect(post('/bulk-update-keepmemo')).resolves.toHaveProperty('status', 503);
    await expect(post('/chat/mark-read')).resolves.toHaveProperty('status', 503);
  });

  it('fails closed for PUT and DELETE mutating APIs', async () => {
    delete process.env.AIO_ADMIN_TOKEN;

    await expect(apiRequest('PUT', '/manual-members/1')).resolves.toHaveProperty('status', 503);
    await expect(apiRequest('DELETE', '/manual-members/1')).resolves.toHaveProperty('status', 503);
  });

  it('guards all mutating methods under the mounted /api prefix', async () => {
    process.env.AIO_ADMIN_TOKEN='test-admin-token';

    await expect(apiRequest('PUT', '/api/manual-members/1')).resolves.toHaveProperty('status', 403);
    await expect(apiRequest('DELETE', '/api/manual-members/1')).resolves.toHaveProperty('status', 403);
    await expect(post('/api/daily-rates')).resolves.toHaveProperty('status', 403);
  });
});
