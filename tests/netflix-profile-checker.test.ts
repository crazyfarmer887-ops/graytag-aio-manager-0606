import { describe, expect, test, vi } from 'vitest';
import { checkNetflixProfiles, extractNetflixProfileCountFromPage, fetchNetflixEmailCodeViaEmailServer, profileAuditResultFromNetflixCount } from '../src/api/netflix-profile-checker';

function pageWithCounts(counts: Record<string, number>) {
  return {
    locator: (selector: string) => ({ count: async () => counts[selector] ?? 0 }),
  } as any;
}

describe('netflix profile checker', () => {
  test('extracts profile count using Netflix profile selectors with fallback order', async () => {
    const page = pageWithCounts({
      '[data-uia="profile-link"]': 0,
      '.profile-link': 4,
    });
    await expect(extractNetflixProfileCountFromPage(page)).resolves.toBe(4);
  });

  test('builds match or mismatch profile audit results from Netflix count', () => {
    expect(profileAuditResultFromNetflixCount(4, 4).status).toBe('match');
    expect(profileAuditResultFromNetflixCount(5, 4).status).toBe('mismatch');
  });

  test('logs in, handles email code callback, and returns profile count with an injected browser', async () => {
    const page = {
      goto: vi.fn(),
      $$: async (selector: string) => selector === '[data-uia="profile-link"]' ? [{}, {}, {}] : [],
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      type: vi.fn(),
      click: vi.fn(),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: (selector: string) => ({ count: async () => selector === '[data-uia="profile-link"]' ? 3 : 0 }),
      $: vi.fn().mockResolvedValueOnce({}),
      keyboard: { press: vi.fn() },
    } as any;
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() } as any;

    const result = await checkNetflixProfiles({
      email: 'netflix@example.com',
      password: 'secret',
      expectedPartyCount: 3,
      launchBrowser: async () => browser,
      fetchEmailCode: async () => '123456',
    });

    expect(result.actualProfileCount).toBe(3);
    expect(result.status).toBe('match');
    expect(result.checker).toBe('netflix-browser');
    expect(page.type).toHaveBeenCalledWith('input[name="userLoginId"]', 'netflix@example.com', expect.any(Object));
    expect(page.type).toHaveBeenCalledWith('input[name="password"]', 'secret', expect.any(Object));
  });

  test('fetches the newest Netflix email verification code from Email Verify server', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        emails: [
          { subject: 'Other service', from_addr: 'noreply@example.com', timestamp_sec: 200, extractedAuth: { codes: ['111111'] } },
          { subject: 'Netflix sign-in code', from_addr: 'info@netflix.com', timestamp_sec: 210, extractedAuth: { codes: ['654321'] } },
        ],
      }),
    } as any);

    await expect(fetchNetflixEmailCodeViaEmailServer({
      email: 'alias@example.com',
      requestedAfter: 100,
      emailServer: 'http://127.0.0.1:3001',
    })).resolves.toBe('654321');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/email/list?alias=alias%40example.com&limit=20');
    fetchMock.mockRestore();
  });

  test('reports a clear Email Verify access error when the email server returns JSON 403', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: '이메일 접근 인증이 필요해요' }),
      text: async () => '{"error":"이메일 접근 인증이 필요해요"}',
    } as any);

    await expect(fetchNetflixEmailCodeViaEmailServer({
      email: 'alias@example.com',
      requestedAfter: 100,
      emailServer: 'http://127.0.0.1:3001',
    })).rejects.toThrow('Email Verify 접근 실패: 이메일 접근 인증이 필요해요');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/email/list?alias=alias%40example.com&limit=20');
    fetchMock.mockRestore();
  });

  test('reports a clear Email Verify response error instead of leaking HTML JSON parse failures', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<!doctype html>',
    } as any);

    await expect(fetchNetflixEmailCodeViaEmailServer({
      email: 'alias@example.com',
      requestedAfter: 100,
      emailServer: 'http://127.0.0.1:3001',
    })).rejects.toThrow('Email Verify 응답이 JSON이 아니에요');
    fetchMock.mockRestore();
  });

  test('returns an error result instead of throwing when required credentials are missing', async () => {
    const result = await checkNetflixProfiles({
      email: 'netflix@example.com',
      password: '',
      expectedPartyCount: 3,
    });

    expect(result.status).toBe('error');
    expect(result.message).toContain('비밀번호');
  });

  test('returns an error result instead of throwing when Chromium cannot launch', async () => {
    const result = await checkNetflixProfiles({
      email: 'netflix@example.com',
      password: 'secret',
      expectedPartyCount: 3,
      launchBrowser: async () => { throw new Error('browser launch failed'); },
    });

    expect(result.status).toBe('error');
    expect(result.actualProfileCount).toBeNull();
    expect(result.message).toContain('브라우저 실행 실패');
  });
});
