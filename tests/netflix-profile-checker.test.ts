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

  test('extracts profile count from Netflix account profiles rows', async () => {
    const page = pageWithCounts({
      '[data-uia="profile-link"]': 0,
      '.profile-link': 0,
      'a[href*="/account/profiles/"]': 5,
    });
    await expect(extractNetflixProfileCountFromPage(page)).resolves.toBe(5);
  });

  test('builds match or mismatch profile audit results from Netflix count', () => {
    expect(profileAuditResultFromNetflixCount(4, 4).status).toBe('match');
    expect(profileAuditResultFromNetflixCount(5, 4).status).toBe('mismatch');
  });

  test('logs in, opens account profiles page, and returns profile count with an injected browser', async () => {
    let currentUrl = '';
    const page = {
      goto: vi.fn(async (url: string) => { currentUrl = url; }),
      $$: async (selector: string) => currentUrl.includes('/account/profiles') && selector === 'a[href*="/account/profiles/"]' ? [{}, {}, {}, {}, {}] : [],
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      type: vi.fn(),
      click: vi.fn(),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      locator: (selector: string) => ({ count: async () => currentUrl.includes('/account/profiles') && selector === 'a[href*="/account/profiles/"]' ? 5 : 0 }),
      keyboard: { press: vi.fn() },
    } as any;
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() } as any;

    const result = await checkNetflixProfiles({
      email: 'netflix@example.com',
      password: 'secret',
      expectedPartyCount: 5,
      launchBrowser: async () => browser,
      fetchEmailCode: async () => '123456',
    });

    expect(result.actualProfileCount).toBe(5);
    expect(result.status).toBe('match');
    expect(page.goto).toHaveBeenCalledWith('https://www.netflix.com/account/profiles', expect.any(Object));
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

  test('returns a clear login challenge error when Netflix redirects back to login after account profiles', async () => {
    let currentUrl = '';
    const page = {
      goto: vi.fn(async (url: string) => { currentUrl = url.includes('/account/profiles') ? 'https://www.netflix.com/kr-en/login?serverState=blocked' : url; }),
      url: vi.fn(() => currentUrl),
      $$: vi.fn(async () => []),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      type: vi.fn(),
      click: vi.fn(),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn() },
    } as any;
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() } as any;

    const result = await checkNetflixProfiles({
      email: 'netflix@example.com',
      password: 'secret',
      expectedPartyCount: 3,
      launchBrowser: async () => browser,
    });

    expect(result.status).toBe('error');
    expect(result.message).toContain('넷플릭스 로그인 확인이 필요해요');
    expect(result.message).not.toContain('프로필 선택 화면');
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
