import { describe, expect, test } from 'vitest';
import { parseJsonResponse } from '../src/web/lib/fetch-json';

describe('parseJsonResponse', () => {
  test('parses JSON responses normally', async () => {
    const res = new Response(JSON.stringify({ ok: true, value: 7 }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

    await expect(parseJsonResponse<{ ok: boolean; value: number }>(res, '/api/test')).resolves.toEqual({ ok: true, value: 7 });
  });

  test('rejects HTML responses with endpoint context instead of Unexpected token HTML parse errors', async () => {
    const res = new Response('<html> <h1>로그인 필요</h1></html>', {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const err = await parseJsonResponse(res, '/api/my/management').catch((error) => error as Error);
    expect(err.message).toMatch(/\/api\/my\/management 응답이 JSON이 아니에요/);
    expect(err.message).not.toMatch(/Unexpected token '<'/);
  });
});
