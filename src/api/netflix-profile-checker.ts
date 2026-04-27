import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareProfileCounts, type ProfileAuditStoredResult, type ProfileAuditStatus } from '../lib/profile-audit';

const NETFLIX_PROFILE_SELECTORS = [
  '[data-uia="profile-link"]',
  '.profile-link',
  '.profile-icon',
  'li.profile',
  '[data-uia="profile-choices"] a',
  'a[href*="/account/profiles/"]',
  'a[href*="/account/profile/"]',
  '[data-uia*="profile"] a[href]',
];

const NETFLIX_CODE_INPUT_SELECTORS = [
  'input[name="code"]',
  'input[name="otp"]',
  'input[name="verificationCode"]',
  'input[name="twoFactorCode"]',
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
];

export interface NetflixCheckInput {
  email: string;
  password: string;
  expectedPartyCount: number;
  launchBrowser?: () => Promise<any>;
  fetchEmailCode?: (input: { email: string; requestedAfter: number }) => Promise<string | null>;
}

export interface NetflixCheckResult extends ProfileAuditStoredResult {
  status: ProfileAuditStatus;
}

export function netflixErrorResult(message: string): NetflixCheckResult {
  return {
    actualProfileCount: null,
    checkedAt: new Date().toISOString(),
    checker: 'netflix-browser',
    status: 'error',
    message,
  };
}

function localChromeCandidates(): string[] {
  return [
    process.env.CHROMIUM_PATH || '',
    resolve(process.cwd(), '.cache/puppeteer/chrome/linux-148.0.7778.56/chrome-linux64/chrome'),
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
}

export function resolveChromiumExecutablePath(): string {
  return localChromeCandidates().find((candidate) => existsSync(candidate)) || '/usr/bin/chromium-browser';
}

export async function launchDefaultChromium() {
  const puppeteer = await (new Function('specifier', 'return import(specifier)') as any)('puppeteer-core');
  return puppeteer.launch({
    executablePath: resolveChromiumExecutablePath(),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1365,900',
    ],
  });
}

async function firstVisibleSelector(page: any, selectors: string[], timeout = 1200): Promise<string | null> {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout });
      return selector;
    } catch { /* try next */ }
  }
  return null;
}

export async function extractNetflixProfileCountFromPage(page: any): Promise<number> {
  for (const selector of NETFLIX_PROFILE_SELECTORS) {
    try {
      if (typeof page.$$ === 'function') {
        const elements = await page.$$(selector);
        if (elements.length > 0) return elements.length;
      } else if (typeof page.locator === 'function') {
        const count = await page.locator(selector).count();
        if (count > 0) return count;
      }
    } catch { /* try next */ }
  }
  return 0;
}

export function profileAuditResultFromNetflixCount(actualProfileCount: number, expectedPartyCount: number): NetflixCheckResult {
  const status = compareProfileCounts(actualProfileCount, expectedPartyCount) as 'match' | 'mismatch';
  return {
    actualProfileCount,
    checkedAt: new Date().toISOString(),
    checker: 'netflix-browser',
    status,
    message: status === 'match'
      ? `넷플릭스 프로필 ${actualProfileCount}개 확인 — 계정관리와 일치`
      : `넷플릭스 프로필 ${actualProfileCount}개 / 계정관리 ${expectedPartyCount}명 — 불일치`,
  };
}

export async function fetchNetflixEmailCodeViaEmailServer(input: { email: string; requestedAfter: number; emailServer?: string }): Promise<string | null> {
  const emailServer = input.emailServer || process.env.EMAIL_SERVER || 'http://127.0.0.1:3001';
  const url = new URL('/api/email/list', emailServer);
  url.searchParams.set('alias', input.email);
  url.searchParams.set('limit', '20');
  const res = await fetch(url);
  const contentType = res.headers?.get?.('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Email Verify 응답이 JSON이 아니에요. 이메일 서버 라우트/인증 설정을 확인해야 해요.');
  }
  const json = await res.json() as any;
  if (!res.ok) {
    throw new Error(`Email Verify 접근 실패: ${json?.error || `HTTP ${res.status}`}`);
  }
  const emails = Array.isArray(json?.emails) ? json.emails : [];
  for (const mail of emails) {
    const ts = Number(mail.timestamp_sec || 0);
    const from = `${mail.from_addr || ''} ${mail.original_from || ''}`.toLowerCase();
    const subject = String(mail.subject || '').toLowerCase();
    if (ts && ts + 180 < input.requestedAfter) continue;
    if (!from.includes('netflix') && !subject.includes('netflix') && !subject.includes('넷플릭스')) continue;
    const code = mail.extractedAuth?.codes?.[0] || mail.extractedAuth?.code || null;
    if (code) return String(code);
  }
  return null;
}

async function maybeSubmitEmailCode(page: any, input: NetflixCheckInput, requestedAfter: number) {
  const codeInput = await firstVisibleSelector(page, NETFLIX_CODE_INPUT_SELECTORS, 900);
  if (!codeInput || !input.fetchEmailCode) return false;
  const code = await input.fetchEmailCode({ email: input.email, requestedAfter });
  if (!code) throw new Error('넷플릭스 이메일 인증 코드를 찾지 못했어요.');
  await page.type(codeInput, code, { delay: 40 });
  try { await page.keyboard.press('Enter'); } catch { /* ignore */ }
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null),
    page.waitForTimeout(3000),
  ]);
  return true;
}

export async function checkNetflixProfiles(input: NetflixCheckInput): Promise<NetflixCheckResult> {
  if (!input.email?.trim()) return netflixErrorResult('넷플릭스 이메일이 필요해요.');
  if (!input.password?.trim()) return netflixErrorResult('넷플릭스 비밀번호가 필요해요.');

  const launchBrowser = input.launchBrowser || launchDefaultChromium;
  let browser: any;
  try {
    browser = await launchBrowser();
  } catch (error: any) {
    return netflixErrorResult(`브라우저 실행 실패: ${error?.message || 'Chromium을 시작하지 못했어요.'}`);
  }
  const requestedAfter = Math.floor(Date.now() / 1000);

  try {
    const page = await browser.newPage();
    if (page.setUserAgent) {
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36');
    }
    if (page.setViewport) await page.setViewport({ width: 1365, height: 900 });

    await page.goto('https://www.netflix.com/login', { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForSelector('input[name="userLoginId"]', { timeout: 20000 });
    await page.type('input[name="userLoginId"]', input.email, { delay: 25 });
    await page.type('input[name="password"]', input.password, { delay: 25 });
    await Promise.allSettled([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    ]);

    await maybeSubmitEmailCode(page, input, requestedAfter);

    await page.goto('https://www.netflix.com/account/profiles', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
    const accountProfilesCount = await extractNetflixProfileCountFromPage(page);
    if (accountProfilesCount > 0) return profileAuditResultFromNetflixCount(accountProfilesCount, input.expectedPartyCount);

    const count = await extractNetflixProfileCountFromPage(page);
    if (count > 0) return profileAuditResultFromNetflixCount(count, input.expectedPartyCount);

    await page.goto('https://www.netflix.com/profiles/manage', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => null);
    const fallbackCount = await extractNetflixProfileCountFromPage(page);
    if (fallbackCount > 0) return profileAuditResultFromNetflixCount(fallbackCount, input.expectedPartyCount);

    throw new Error('넷플릭스 로그인은 되었지만 프로필 선택 화면을 찾지 못했어요.');
  } catch (error: any) {
    return netflixErrorResult(error?.message || '넷플릭스 프로필 조회 실패');
  } finally {
    try { await browser.close(); } catch { /* ignore close failure */ }
  }
}
