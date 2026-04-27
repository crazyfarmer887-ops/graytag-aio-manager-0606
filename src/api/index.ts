import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { cors } from "hono/cors"
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { sendSellerAlert } from '../alerts/telegram';
import { appendAuditLog, auditRequestId, readAuditLog } from './audit-log';
import { assertPriceChangeAllowed, loadPriceSafetyConfig, previewPriceChange, recordSuccessfulPriceDecrease, savePriceSafetyConfig } from './price-safety';
import { loadSafeModeConfig, saveSafeModeConfig } from './safe-mode';
import { resolveEmailAliasFill } from './email-alias-fill';
import { buildFinishedDealsUrl } from '../lib/graytag-fill';
import { DEFAULT_MANAGEMENT_CACHE_TTL_MS, isAutoSessionManagementRequest, managementCache, shouldForceManagementRefresh } from './management-cache';
import { buildProfileAuditRows, profileAuditKey, runProfileCheckPlaceholder, summarizeProfileAudit, type ProfileAuditRow, type ProfileAuditStore } from '../lib/profile-audit';
import { createProfileAuditProgress, finishProfileAuditProgress, loadProfileAuditStore, saveProfileAuditStore, updateProfileAuditProgress, type ProfileAuditProgress } from './profile-audit';
import { checkNetflixProfiles, fetchNetflixEmailCodeViaEmailServer } from './netflix-profile-checker';

const EMAIL_SERVER = "http://127.0.0.1:3001";
const app = new Hono();
app.use(cors({ origin: "*" }));

const PUBLIC_API_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_REQUIRED_GET_PREFIXES = [
  '/session/cookies',
  '/session/status',
  '/chat/rooms',
  '/chat/messages',
  '/chat/poll',
  '/chat/auto-reply-log',
  '/price-safety',
  '/audit-log',
  '/safe-mode',
  '/email-alias-fill',
  '/profile-audit',
];

function normalizedApiPath(path: string): string {
  return path.startsWith('/api/') ? path.slice(4) : path;
}

function requiresAdminAuth(method: string, path = ''): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'OPTIONS') return false;
  if (!PUBLIC_API_METHODS.has(upperMethod)) return true;
  const normalizedPath = normalizedApiPath(path);
  return ADMIN_REQUIRED_GET_PREFIXES.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

function configuredAdminToken(): string | null {
  const token = process.env.AIO_ADMIN_TOKEN?.trim();
  return token ? token : null;
}

function bearerToken(value: string | undefined): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function hasValidAdminToken(c: any, token: string): boolean {
  const provided = bearerToken(c.req.header('authorization')) || c.req.header('x-admin-token')?.trim();
  return provided === token;
}

app.use('*', async (c, next) => {
  if (!requiresAdminAuth(c.req.method, c.req.path)) return next();

  const token = configuredAdminToken();
  if (!token) {
    return c.json({ ok: false, error: 'admin auth is not configured' }, 503);
  }

  if (!hasValidAdminToken(c, token)) {
    return c.json({ ok: false, error: 'forbidden' }, 403);
  }

  return next();
});

function writeAudit(entry: Parameters<typeof appendAuditLog>[0]) {
  try { appendAuditLog(entry); } catch (e: any) { console.warn('[AuditLog] append failed:', e?.message || e); }
}

const SAFE_MODE_RISKY_PATHS = new Set([
  '/my/update-price',
  '/my/delete-products',
  '/auto-undercutter/run',
  '/auto-undercutter/state',
  '/auto-sync-prices',
  '/chat/send',
  '/post/create',
  '/post/keepAcct',
  '/bulk-update-keepmemo',
]);

function isSafeModeRiskyOperation(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS') return false;
  const normalizedPath = normalizedApiPath(path);
  return SAFE_MODE_RISKY_PATHS.has(normalizedPath);
}

app.use('*', async (c, next) => {
  if (!isSafeModeRiskyOperation(c.req.method, c.req.path)) return next();

  const safeMode = loadSafeModeConfig();
  if (!safeMode.enabled) return next();

  const requestId = auditRequestId(c);
  const normalizedPath = normalizedApiPath(c.req.path);
  writeAudit({
    actor: 'admin',
    action: 'safe-mode.blocked',
    targetType: 'route',
    targetId: normalizedPath,
    summary: `safe mode blocked ${c.req.method.toUpperCase()} ${normalizedPath}`,
    result: 'blocked',
    requestId,
    details: { method: c.req.method.toUpperCase(), path: normalizedPath, safeMode },
  });

  return c.json({
    ok: false,
    error: 'SAFE_MODE_ENABLED',
    message: '안전 모드가 켜져 있어 위험 작업이 잠겨 있습니다.',
    safeMode,
  }, 423);
});

function auditResultFromResults(results: any[]): 'success' | 'blocked' | 'error' {
  if (results.some((r) => r?.error === 'PRICE_SAFETY_BLOCKED' || r?.action === 'blocked')) return 'blocked';
  if (results.some((r) => r?.ok === false || r?.action === 'error')) return 'error';
  return 'success';
}

function auditLimit(value: string | undefined): number {
  const n = Number(value || 50);
  return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 50;
}

app.get('/audit-log', (c) => {
  const limit = auditLimit(c.req.query('limit'));
  return c.json({ entries: readAuditLog({ limit }), limit });
});
app.get('/api/audit-log', (c) => {
  const limit = auditLimit(c.req.query('limit'));
  return c.json({ entries: readAuditLog({ limit }), limit });
});

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// ─── Session Keeper 쿠키 자동 로드 ─────────────────────────
const SESSION_COOKIE_PATH = '/home/ubuntu/graytag-session/cookies.json';

function loadSessionCookies(): { AWSALB: string; AWSALBCORS: string; JSESSIONID: string } | null {
  try {
    if (!existsSync(SESSION_COOKIE_PATH)) return null;
    const raw = JSON.parse(readFileSync(SESSION_COOKIE_PATH, 'utf8'));
    if (!raw.JSESSIONID) return null;
    return { AWSALB: raw.AWSALB || '', AWSALBCORS: raw.AWSALBCORS || '', JSESSIONID: raw.JSESSIONID };
  } catch { return null; }
}

/** graytag MySQL은 utf8 3바이트 max → 4바이트 SMP 이모지를 ⚠️ 로 대체 */
function sanitizeForGraytag(text: string): string {
  return text.replace(/[\u{10000}-\u{10FFFF}]/gu, '⚠️');
}

/** body에 JSESSIONID가 없으면 session-keeper의 cookies.json에서 자동으로 가져옴 */
function resolveCookies(body: any): { AWSALB: string; AWSALBCORS: string; JSESSIONID: string } | null {
  if (body?.JSESSIONID?.trim()) {
    return { AWSALB: body.AWSALB || '', AWSALBCORS: body.AWSALBCORS || '', JSESSIONID: body.JSESSIONID.trim() };
  }
  // 자동 폴백: session-keeper 쿠키 사용
  return loadSessionCookies();
}

function buildCookieStr(cookies: { AWSALB: string; AWSALBCORS: string; JSESSIONID: string }): string {
  return [
    cookies.AWSALB ? `AWSALB=${cookies.AWSALB}` : '',
    cookies.AWSALBCORS ? `AWSALBCORS=${cookies.AWSALBCORS}` : '',
    `JSESSIONID=${cookies.JSESSIONID}`,
  ].filter(Boolean).join('; ');
}

// ─── 세션 쿠키 조회 엔드포인트 (프론트에서 자동 쿠키 상태 확인용) ───
// ─── 세션 쿠키 조회 (graytag 직접 호출 없음 — status 파일 읽기만)
app.get('/session/cookies', (c) => {
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ ok: false, error: 'Session keeper 쿠키 없음' });

  // session-keeper가 기록한 상태 파일로 판단 (추가 요청 없음)
  let valid = true;
  let detail = '';
  try {
    const s = JSON.parse(readFileSync('/tmp/graytag-session-status.json', 'utf8'));
    // consecutiveAuthFails >= 2 면 진짜 만료 (v6 재로그인 트리거 기준과 동일)
    valid = s.status === 'ok' || (s.consecutiveAuthFails ?? 0) < 2;
    detail = s.detail || '';
  } catch { /* 파일 없으면 낙관적으로 true */ }

  return c.json({
    ok: true,
    valid,
    detail,
    JSESSIONID: maskSecret(cookies.JSESSIONID),
    hasJSESSIONID: Boolean(cookies.JSESSIONID),
    AWSALB: cookies.AWSALB ? '✅' : '',
    AWSALBCORS: cookies.AWSALBCORS ? '✅' : '',
  });
});

// ─── 세션 상태 (session-keeper v3 상태 파일) ────────────────
app.get('/session/status', (c) => {
  try {
    const raw = readFileSync('/tmp/graytag-session-status.json', 'utf8');
    const status = JSON.parse(raw);
    // 마지막 성공으로부터의 경과 시간
    const lastSuccessMs = Date.now() - new Date(status.lastSuccess).getTime();
    const lastKakaoMs = Date.now() - new Date(status.lastKakaoRefresh).getTime();
    return c.json({
      status: typeof status.status === 'string' ? status.status : 'unknown',
      detail: typeof status.detail === 'string' ? status.detail : '',
      lastSuccess: typeof status.lastSuccess === 'string' ? status.lastSuccess : null,
      lastKakaoRefresh: typeof status.lastKakaoRefresh === 'string' ? status.lastKakaoRefresh : null,
      consecutiveAuthFails: Number.isFinite(Number(status.consecutiveAuthFails)) ? Number(status.consecutiveAuthFails) : 0,
      elapsedSinceSuccess: Math.round(lastSuccessMs / 1000),
      elapsedSinceKakaoRefresh: Math.round(lastKakaoMs / 1000),
      isHealthy: status.status === 'ok' && lastSuccessMs < 5 * 60 * 1000, // 최근 5분 내 성공
    });
  } catch {
    return c.json({ status: 'unknown', detail: '상태 파일 없음', isHealthy: false });
  }
});

// 카카오 세션 강제 갱신
app.post('/session/refresh-kakao', async (c) => {
  try {
    const pidPath = '/home/ubuntu/graytag-session/session-keeper.pid';
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, 'utf8').trim());
      // 프로세스에 SIGUSR1 시그널 전송 (강제 갱신)
      process.kill(pid, 'SIGUSR1');
      return c.json({ ok: true, message: '카카오 세션 강제 갱신 신호 전송 완료' });
    }
    return c.json({ ok: false, error: 'Session keeper 프로세스 미실행' }, 503);
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});

const CATEGORIES = [
  { key: 'netflix',  label: '넷플릭스',    query: '넷플릭스' },
  { key: 'disney',   label: '디즈니플러스', query: '디즈니플러스' },
  { key: 'youtube',  label: '유튜브',      query: '유튜브' },
  { key: 'watcha',   label: '왓챠플레이',   query: '왓챠플레이' },
  { key: 'wavve',    label: '웨이브',      query: '웨이브' },
  { key: 'laftel',   label: '라프텔',      query: '라프텔' },
  { key: 'tving',    label: '티빙',        query: '티빙' },
  { key: 'coupang',  label: '쿠팡플레이',   query: '쿠팡플레이' },
  { key: 'apple',    label: 'AppleOne',   query: 'AppleOne' },
  { key: 'prime',    label: '프라임비디오', query: '프라임비디오' },
];

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
};


// ─── 프록시 로테이터 + Rate Limiter ──────────────────────────
let _proxyList: string[] = [];       // "host:port" 형식
let _proxyIndex = 0;
let _lastGraytagRequest = 0;
let _rateLimitUntil: number = 0;
let _chatRoomsCache: { rooms: any[]; totalRooms: number; unreadCount: number; updatedAt: string } | null = null;

/** webshare 프록시 리스트 로드 (서버 시작 시 + 1시간마다 자동 갱신) */
async function loadProxies() {
  const url = 'https://proxy.webshare.io/api/v2/proxy/list/download/lmvkutzxtmxjggpoumjedbagwnijvfhgxwzptris/-/any/username/direct/-/?plan_id=13115101';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // 포맷: ip:port:user:pass
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.includes(':'));
    if (lines.length === 0) throw new Error('프록시 리스트 비어있음');
    _proxyList = lines;
    _proxyIndex = 0;
    console.log(`[ProxyRotator] ✓ ${lines.length}개 프록시 로드됨`);
  } catch (e: any) {
    console.warn(`[ProxyRotator] 프록시 로드 실패: ${e.message}`);
  }
}

/** ip:port:user:pass → http://user:pass@ip:port */
function proxyToUrl(proxy: string): string {
  const parts = proxy.split(':');
  if (parts.length === 4) {
    const [ip, port, user, pass] = parts;
    return `http://${user}:${pass}@${ip}:${port}`;
  }
  return `http://${proxy}`;
}

/** 다음 프록시로 회전 */
function rotateProxy(reason: string) {
  if (_proxyList.length === 0) return;
  const prev = _proxyList[_proxyIndex].split(':').slice(0,2).join(':');
  _proxyIndex = (_proxyIndex + 1) % _proxyList.length;
  const next = _proxyList[_proxyIndex].split(':').slice(0,2).join(':');
  console.log(`[ProxyRotator] ${reason} → 회전: ${prev} → ${next} (${_proxyIndex + 1}/${_proxyList.length})`);
}

/** curl로 프록시 경유 fetch (tsx 환경 호환) */
async function curlFetch(url: string, options: RequestInit = {}, proxyUrl: string): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers as Record<string, string> || {};

  const args = [
    '-s', '-S',
    '-x', proxyUrl,
    '-X', method,
    '--max-time', '15',
    '-w', '\n__STATUS__%{http_code}',
  ];

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`);
  }

  if (options.body && typeof options.body === 'string') {
    args.push('-d', options.body);
  }

  args.push(url);

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  const statusMatch = stdout.match(/__STATUS__(\d+)$/);
  const status = statusMatch ? parseInt(statusMatch[1]) : 0;
  const body = stdout.replace(/__STATUS__\d+$/, '');

  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 직접 호출 (프록시 없음) */
async function directFetch(url: string, options?: RequestInit): Promise<Response> {
  return fetch(url, options);
}

/**
 * rateLimitedFetch: 403 즉시 다음 프록시로 재시도
 * - 프록시 있으면: 1번 → 2번 → 3번 ... 전체 순환 후 포기
 * - 프록시 없으면: 기존 방식 (30초 백오프)
 */
async function rateLimitedFetch(url: string, options?: RequestInit, bypass = false): Promise<Response> {
  // 프록시 없으면 기존 방식
  if (_proxyList.length === 0) {
    const elapsed = Date.now() - _lastGraytagRequest;
    if (elapsed < 1500) await new Promise(r => setTimeout(r, 1500 - elapsed));
    _lastGraytagRequest = Date.now();
    const resp = await fetch(url, options);
    if (resp.status === 403) console.log('[rate-limiter] 403 감지 (프록시 없음)');
    return resp;
  }

  // 프록시 있으면: 최대 전체 프록시 수만큼 재시도
  const maxAttempts = Math.min(_proxyList.length, 10);
  let lastResp: Response | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const elapsed = Date.now() - _lastGraytagRequest;
    if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
    _lastGraytagRequest = Date.now();

    try {
      const proxyUrl = _proxyList.length > 0 ? proxyToUrl(_proxyList[_proxyIndex]) : null;
      const resp = proxyUrl
        ? await curlFetch(url, options, proxyUrl)
        : await fetch(url, options);

      if (resp.status === 403 || resp.status === 429) {
        console.log(`[ProxyRotator] 시도 ${attempt + 1}/${maxAttempts} — ${resp.status} 감지, 다음 프록시로`);
        rotateProxy(`${resp.status}`);
        lastResp = resp;
        continue; // 즉시 다음 프록시
      }

      // 성공
      if (attempt > 0) console.log(`[ProxyRotator] ✓ 시도 ${attempt + 1}번째에 성공`);
      return resp;

    } catch (e: any) {
      console.log(`[ProxyRotator] 시도 ${attempt + 1}/${maxAttempts} — 연결 실패: ${e.message}, 다음 프록시로`);
      rotateProxy('연결실패');
      continue;
    }
  }

  console.log(`[ProxyRotator] ✗ 모든 프록시 실패 — 마지막 응답 반환`);
  return lastResp ?? new Response(JSON.stringify({ ok: false, error: '모든 프록시 실패' }), {
    status: 429, headers: { 'Content-Type': 'application/json' }
  });
}

// 서버 시작 시 프록시 로드 + 1시간마다 갱신
loadProxies();
setInterval(loadProxies, 60 * 60 * 1000);

async function safeJson(resp: Response) {
  if (resp.status === 302 || resp.status === 301) return { ok: false, redirect: true };
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  if (!ct.includes('json') && !ct.includes('javascript')) return { ok: false, html: text.slice(0, 200) };
  try { return { ok: true, data: JSON.parse(text) }; }
  catch { return { ok: false, html: text.slice(0, 200) }; }
}

// 가격 조회 - 카테고리별 Top10
app.get('/prices/:category', async (c) => {
  const { category } = c.req.param();
  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return c.json({ error: '알 수 없는 카테고리' }, 400);
  try {
    const url = `https://graytag.co.kr/ws/product/findProducts?productAvailable=OnSale&sorting=PricePerDay&productCategory=${encodeURIComponent(cat.query)}&page=1&rows=100`;
    const resp = await directFetch(url, { headers: { ...BASE_HEADERS, Referer: 'https://graytag.co.kr/home' } });
    const r = await safeJson(resp);
    if (!r.ok || !r.data?.succeeded) return c.json({ error: '조회 실패', detail: r }, 500);
    const products = (r.data.data?.products || []).map((p: any, i: number) => ({
      rank: i + 1, usid: p.usid,
      name: (p.name || '').replace(/&#x[0-9a-fA-F]+;/g, '').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim(),
      lenderName: p.lenderName, pricePerDay: p.pricePerDay,
      pricePerDayNum: Math.ceil((p.purePrice || p.price || 0) / (p.remainderDays || 1)),
      price: p.price, purePrice: p.purePrice, endDate: p.endDate, remainderDays: p.remainderDays, seats: p.netflixSeatCount || 6,
    }));
    return c.json({ category: cat.label, count: r.data.data?.onSaleCount || 0, products, updatedAt: new Date().toISOString() });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 전체 카테고리 최저가 요약
app.get('/prices', async (c) => {
  const results = await Promise.all(CATEGORIES.map(async (cat) => {
    try {
      const url = `https://graytag.co.kr/ws/product/findProducts?productAvailable=OnSale&sorting=PricePerDay&productCategory=${encodeURIComponent(cat.query)}&page=1&rows=1`;
      const resp = await directFetch(url, { headers: { ...BASE_HEADERS, Referer: 'https://graytag.co.kr/home' } });
      const r = await safeJson(resp);
      const p = r.data?.data?.products?.[0];
      return { key: cat.key, label: cat.label, count: r.data?.data?.onSaleCount || 0,
        lowestPricePerDay: p?.pricePerDay || '-', lowestPricePerDayNum: Math.ceil((p?.purePrice || p?.price || 0) / (p?.remainderDays || 1)),
        lowestPrice: p?.price || '-', lenderName: p?.lenderName || '-' };
    } catch { return { key: cat.key, label: cat.label, count: 0, lowestPricePerDay: '-', lowestPricePerDayNum: 0, lowestPrice: '-', lenderName: '-' }; }
  }));
  return c.json({ categories: results, updatedAt: new Date().toISOString() });
});

// 내 계정 파티 조회
app.post('/my/accounts', async (c) => {
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) return c.json({ error: 'JSESSIONID가 필요합니다 (수동 입력 또는 session-keeper 쿠키 없음)' }, 400);

  const cookieStr = buildCookieStr(cookies);
  const authedHeaders = (referer: string) => ({ ...BASE_HEADERS, Cookie: cookieStr, Referer: referer });

  const testResp = await rateLimitedFetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1',
    { headers: authedHeaders('https://graytag.co.kr/borrower/deal/list'), redirect: 'manual' });
  if (testResp.status === 302 || testResp.status === 301)
    return c.json({ error: '쿠키가 만료됐어요. session-keeper가 자동 갱신할 때까지 잠시 기다려주세요.', code: 'COOKIE_EXPIRED' }, 401);

  try {
    const [borrowerResp, lenderResp] = await Promise.all([
      rateLimitedFetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=50',
        { headers: authedHeaders('https://graytag.co.kr/borrower/deal/list'), redirect: 'manual' }),
      rateLimitedFetch('https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=500',
        { headers: authedHeaders('https://graytag.co.kr/lender/deal/list'), redirect: 'manual' }),
    ]);
    const [br, lr] = await Promise.all([safeJson(borrowerResp), safeJson(lenderResp)]);
    const mapDeal = (d: any, role: 'borrower' | 'lender') => ({
      dealUsid: d.dealUsid, productUsid: d.productUsid, productName: d.productName,
      productType: d.productTypeString, counterpartName: role === 'borrower' ? d.lenderName : d.borrowerName,
      price: d.price, remainderDays: d.remainderDays, endDateTime: d.endDateTime,
      dealStatus: d.dealStatus, dealStatusName: role === 'borrower' ? d.borrowerDealStatusName : d.lenderDealStatusName,
    });
    return c.json({
      borrowerDeals: (br.data?.data?.borrowerDeals || []).map((d: any) => mapDeal(d, 'borrower')),
      lenderDeals: (lr.data?.data?.lenderDeals || []).map((d: any) => mapDeal(d, 'lender')),
      totalBorrower: (br.data?.data?.borrowerDeals || []).length,
      totalLender: (lr.data?.data?.lenderDeals || []).length,
      cookieSource: body?.JSESSIONID?.trim() ? 'manual' : 'session-keeper',
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 계정 관리 - 서비스별 > 상품별 > 파티원 + 수입 통계
app.post('/my/management', async (c) => {
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) return c.json({ error: 'JSESSIONID가 필요합니다 (수동 입력 또는 session-keeper 쿠키 없음)' }, 400);

  const cookieStr = buildCookieStr(cookies);
  const authedHeaders = (referer: string) => ({ ...BASE_HEADERS, Cookie: cookieStr, Referer: referer });

  const loadManagementFresh = async () => {
    // 쿠키 유효성 확인
    const testResp = await rateLimitedFetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1',
      { headers: authedHeaders('https://graytag.co.kr/borrower/deal/list'), redirect: 'manual' });
    if (testResp.status === 302 || testResp.status === 301) {
      throw new Error('쿠키가 만료됐어요.');
    }

    // 무한스크롤 완전 소진: page 반복으로 모든 거래 가져오기
    // - findAfterUsingLenderDeals: 이용중(Using) 파티원 - 핵심 데이터
    // - findBeforeUsingLenderDeals: 판매중/전달중 등 미이용 상태

    const fetchPagedDeals = async (kind: 'after' | 'before', includeFinished: boolean, referer: string) => {
      const collected: any[] = [];
      for (let page = 1; page <= 10; page++) {
        const resp = await rateLimitedFetch(
          buildFinishedDealsUrl(kind, page, 500, includeFinished),
          { headers: authedHeaders(referer), redirect: 'manual' }
        );
        if (resp.status === 302 || resp.status === 301) break;
        const r = await safeJson(resp);
        const deals: any[] = r.data?.data?.lenderDeals || [];
        collected.push(...deals);
        if (deals.length < 500) break;
      }
      return collected;
    };

    const afterDeals = [
      ...(await fetchPagedDeals('after', false, 'https://graytag.co.kr/lender/deal/listAfterUsing')),
      ...(await fetchPagedDeals('after', true, 'https://graytag.co.kr/lender/deal/listAfterUsing')),
    ];

    const beforeDeals = [
      ...(await fetchPagedDeals('before', false, 'https://graytag.co.kr/lender/deal/list')),
      ...(await fetchPagedDeals('before', true, 'https://graytag.co.kr/lender/deal/list')),
    ];

    console.log(`[management] after=${afterDeals.length}, before=${beforeDeals.length}`);

    // 중복 제거 후 합치기 (dealUsid 기준)
    const seenDeals = new Set<string>();
    const allDeals: any[] = [];
    for (const deal of [...afterDeals, ...beforeDeals]) {
      if (!seenDeals.has(deal.dealUsid)) {
        seenDeals.add(deal.dealUsid);
        allDeals.push(deal);
      }
    }

    // DeliveredAndCheckPrepaid 거래: keepAcct가 없으면 채팅방에서 전달된 계정 파싱
    {
      const deliveredDeals = allDeals.filter((d: any) => d.dealStatus === 'DeliveredAndCheckPrepaid' && d.chatRoomUuid && !d.keepAcct?.trim());
      if (deliveredDeals.length > 0) {
        await Promise.all(deliveredDeals.map(async (deal: any) => {
          try {
            const msgResp = await rateLimitedFetch(
              `https://graytag.co.kr/ws/chat/findChats?uuid=${deal.chatRoomUuid}&page=1`,
              { headers: authedHeaders('https://graytag.co.kr/lender/deal/list'), redirect: 'manual', signal: AbortSignal.timeout(3000) }
            );
            if (!msgResp.ok) return;
            const msgData = await safeJson(msgResp);
            const messages: Array<{ message: string; owned: boolean; informationMessage: boolean }> = msgData.data?.data?.chats || [];
            for (const msg of messages) {
              if (!msg.owned || msg.informationMessage) continue;
              const text = msg.message
                .replace(/&#64;/g, '@')
                .replace(/<br\s*\/?>\s*/gi, '\n')
                .replace(/<[^>]+>/g, '');
              const match = text.match(/아이디\s*:\s*([^\s\n<]+)/);
              if (match) { deal.keepAcct = match[1].trim(); break; }
            }
          } catch { /* 실패해도 계속 */ }
        }));
      }
    }

    const ACTIVE_STATUSES = new Set(['Using', 'UsingNearExpiration', 'Delivered', 'Delivering', 'DeliveredAndCheckPrepaid', 'LendingAcceptanceWaiting', 'Reserved', 'OnSale']);
    const USING_STATUSES = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
    const SKIP_STATUSES = new Set(['Deleted']);

    type MemberEntry = {
      dealUsid: string;
      name: string | null;
      status: string;
      statusName: string;
      price: string;
      purePrice: number;
      realizedSum: number;
      progressRatio: string;
      startDateTime: string | null;
      endDateTime: string | null;
      remainderDays: number;
      source: 'after' | 'before';
    };

    type AccountEntry = {
      email: string;
      serviceType: string;
      members: MemberEntry[];
      usingCount: number;
      activeCount: number;
      totalSlots: number;
      totalIncome: number;
      totalRealizedIncome: number;
      expiryDate: string | null; // 계정 만료일 (멤버 endDateTime 중 가장 먼 것)
      keepPasswd?: string;
    };

    // email(keepAcct) 기준으로 그룹핑
    const accountMap: Record<string, AccountEntry> = {};

    for (const deal of allDeals) {
      if (SKIP_STATUSES.has(deal.dealStatus)) continue;

      const email = deal.keepAcct?.trim() || '(직접전달)';
      const svc = deal.productTypeString || '기타';
      const key = `${email}__${svc}`; // 같은 이메일이라도 서비스가 다르면 분리

      if (!accountMap[key]) {
        accountMap[key] = {
          email,
          serviceType: svc,
          members: [],
          usingCount: 0,
          activeCount: 0,
          totalSlots: deal.netflixSeatCount || 6,
          totalIncome: 0,
          totalRealizedIncome: 0,
          expiryDate: null,
          keepPasswd: deal.keepPasswd?.trim() || undefined,
        };
      }

      const realizedNum = parseInt((deal.realizedSum || '0').replace(/[^0-9]/g, '') || '0');
      const priceNum = parseInt((deal.price || '0').replace(/[^0-9]/g, '') || '0');
      const isActive = ACTIVE_STATUSES.has(deal.dealStatus);
      const isUsing = USING_STATUSES.has(deal.dealStatus);
      const isFromAfter = afterDeals.some(d => d.dealUsid === deal.dealUsid);

      accountMap[key].members.push({
        dealUsid: deal.dealUsid,
        name: deal.borrowerName?.trim() || null,
        status: deal.dealStatus,
        statusName: deal.lenderDealStatusName || deal.dealStatus,
        price: deal.price,
        purePrice: priceNum,
        realizedSum: realizedNum,
        progressRatio: deal.progressRatio || '0%',
        startDateTime: deal.startDateTime,
        endDateTime: deal.endDateTime,
        remainderDays: deal.remainderDays,
        source: isFromAfter ? 'after' : 'before',
      });

      if (isActive) { accountMap[key].activeCount++; accountMap[key].totalIncome += priceNum; }
      if (isUsing) accountMap[key].usingCount++;
      accountMap[key].totalRealizedIncome += realizedNum;

      if (deal.keepPasswd?.trim() && !accountMap[key].keepPasswd) {
        accountMap[key].keepPasswd = deal.keepPasswd.trim();
      }

      // 만료일 = 멤버 endDateTime 중 가장 먼 것
      if (deal.endDateTime) {
        const cur = accountMap[key].expiryDate;
        if (!cur || deal.endDateTime > cur) accountMap[key].expiryDate = deal.endDateTime;
      }
      // totalSlots는 가장 큰 값으로 업데이트
      if ((deal.netflixSeatCount || 6) > accountMap[key].totalSlots) {
        accountMap[key].totalSlots = deal.netflixSeatCount || 6;
      }
    }

    // 서비스 타입별로 계정 묶기
    const serviceMap: Record<string, {
      serviceType: string;
      accounts: AccountEntry[];
      totalUsingMembers: number;
      totalActiveMembers: number;
      totalIncome: number;
      totalRealized: number;
    }> = {};

    for (const entry of Object.values(accountMap)) {
      const svc = entry.serviceType;
      if (!serviceMap[svc]) serviceMap[svc] = { serviceType: svc, accounts: [], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 };
      serviceMap[svc].accounts.push(entry);
      serviceMap[svc].totalUsingMembers += entry.usingCount;
      serviceMap[svc].totalActiveMembers += entry.activeCount;
      serviceMap[svc].totalIncome += entry.totalIncome;
      serviceMap[svc].totalRealized += entry.totalRealizedIncome;
    }

    // 정렬: 서비스는 이용중 많은 순, 계정은 이용중 많은 순
    const services = Object.values(serviceMap)
      .map(s => ({ ...s, accounts: s.accounts.sort((a, b) => b.usingCount - a.usingCount || b.activeCount - a.activeCount) }))
      .sort((a, b) => b.totalUsingMembers - a.totalUsingMembers || b.totalActiveMembers - a.totalActiveMembers);

    // OnSale 게시물 → keepAcct별 매핑 (빈자리 모집 상태 판단용)
    // beforeDeals 전체에서 OnSale 추출 (더 많은 페이지 포함)
    const onSaleByKeepAcct: Record<string, any[]> = {};
    // beforeDeals에서 이미 가져온 것 + 추가 페이지 OnSale
    const allBeforeDeals = [...beforeDeals];
    for (const deal of allBeforeDeals) {
      if (deal.dealStatus === 'OnSale' && deal.keepAcct?.trim()) {
        const key = deal.keepAcct.trim();
        // 중복 방지
        if (!onSaleByKeepAcct[key]) onSaleByKeepAcct[key] = [];
        if (onSaleByKeepAcct[key].some((p: any) => p.productUsid === deal.productUsid)) continue;
        onSaleByKeepAcct[key].push({
          productUsid: deal.productUsid,
          productName: deal.productName,
          productType: deal.productTypeString,
          price: deal.price,
          purePrice: parseInt((deal.price || '0').replace(/[^0-9]/g, '') || '0'),
          endDateTime: deal.endDateTime,
          remainderDays: deal.remainderDays,
          keepAcct: deal.keepAcct,
          keepPasswd: deal.keepPasswd || '',
          keepMemo: deal.keepMemo || '',
        });
      }
    }

    return {
      services,
      onSaleByKeepAcct,
      summary: {
        totalUsingMembers: services.reduce((s, sv) => s + sv.totalUsingMembers, 0),
        totalActiveMembers: services.reduce((s, sv) => s + sv.totalActiveMembers, 0),
        totalIncome: services.reduce((s, sv) => s + sv.totalIncome, 0),
        totalRealized: services.reduce((s, sv) => s + sv.totalRealized, 0),
        totalAccounts: Object.keys(accountMap).length,
      },
      cookieSource: body?.JSESSIONID?.trim() ? 'manual' : 'session-keeper',
      updatedAt: new Date().toISOString(),
    };
  };

  try {
    if (isAutoSessionManagementRequest(body)) {
      const cached = await managementCache.get('auto-session', loadManagementFresh, {
        forceRefresh: shouldForceManagementRefresh(body, c.req.query('refresh'), c.req.header('cache-control')),
      });
      const response = c.json({
        ...cached.data,
        cache: {
          status: cached.cacheStatus,
          updatedAt: new Date(cached.updatedAt).toISOString(),
          ttlMs: DEFAULT_MANAGEMENT_CACHE_TTL_MS,
        },
      });
      response.headers.set('X-Management-Cache', cached.cacheStatus);
      return response;
    }

    return c.json(await loadManagementFresh());
  } catch (e: any) {
    if (e?.message === '쿠키가 만료됐어요.') return c.json({ error: e.message, code: 'COOKIE_EXPIRED' }, 401);
    return c.json({ error: e.message }, 500);
  }
});

// 글 작성 - 상품 등록
app.post('/post/create', async (c) => {
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);
  const { productModel } = body;

  const cookieStr = buildCookieStr(cookies);

  // 쿠키 유효성 확인
  const test = await rateLimitedFetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1', {
    headers: { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr' }, redirect: 'manual',
  });
  if (test.status === 302 || test.status === 301)
    return c.json({ error: '쿠키가 만료됐어요.', code: 'COOKIE_EXPIRED' }, 401);

  try {
    // multipart/form-data 구성 (string으로 직접 구성 - curlFetch 호환)
    const boundary = '----GraytagBoundary' + Date.now().toString(36);
    const productModelJson = JSON.stringify(productModel);
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productModel"; filename="blob"',
      'Content-Type: application/json',
      '',
      productModelJson,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const resp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/registerProduct', {
      method: 'POST',
      headers: {
        'Cookie': cookieStr,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'User-Agent': BASE_HEADERS['User-Agent'],
        'Referer': 'https://graytag.co.kr/lender/product/register/input',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      body: multipartBody,
      redirect: 'manual',
    });

    const r = await safeJson(resp);
    if (!r.ok) return c.json({ error: `등록 실패 (${resp.status})`, detail: r.html }, 500);
    if (!r.data?.succeeded) return c.json({ error: r.data?.message || '등록 실패' }, 400);

    return c.json({ productUsid: r.data.data, ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 계정 자동 전달 설정
app.post('/post/keepAcct', async (c) => {
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) return c.json({ error: '필수 파라미터 누락 (JSESSIONID)' }, 400);
  const { productUsid, keepAcct, keepPasswd, keepMemo } = body;
  if (!productUsid) return c.json({ error: '필수 파라미터 누락 (productUsid)' }, 400);

  const cookieStr = buildCookieStr(cookies);

  try {
    const payload = {
      productUsid,
      keepAcct: keepAcct?.trim(),
      keepPasswd: keepPasswd?.trim(),
      keepMemo: sanitizeForGraytag(keepMemo?.trim() || ''),
    };

    const resp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/updateProductKeepAcct', {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'Cookie': cookieStr,
        'Referer': `https://graytag.co.kr/lender/product/keepAcctSetting?productUsid=${productUsid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    const r = await safeJson(resp);
    if (!r.ok) return c.json({ error: `계정 설정 실패 (${resp.status})` }, 500);
    if (!r.data?.succeeded) return c.json({ error: r.data?.message || '계정 설정 실패' }, 400);

    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// SimpleLogin aliases 프록시 (email 서버(3001)에 위임)
app.get('/sl/aliases', async (c) => {
  try {
    const res = await fetch(`${EMAIL_SERVER}/api/sl/aliases?page=0`);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) { return c.json({ error: e.message, aliases: [] }, 500); }
});

app.get('/email-alias-fill', async (c) => {
  const accountEmail = c.req.query('email') || c.req.query('accountEmail') || '';
  const serviceType = c.req.query('serviceType') || '';
  if (!accountEmail) return c.json({ ok: false, found: false, error: 'email query is required', missing: ['email'] }, 400);

  try {
    const res = await fetch(`${EMAIL_SERVER}/api/sl/aliases?page=0`);
    const data = await res.json() as any;
    const aliases = Array.isArray(data?.aliases) ? data.aliases : [];
    const result = await resolveEmailAliasFill({ accountEmail, serviceType, aliases });
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, found: false, email: accountEmail, serviceType, emailId: null, pin: null, memo: '', missing: ['email', 'pin'], error: e.message }, 500);
  }
});

app.get('/api/email-alias-fill', async (c) => {
  const accountEmail = c.req.query('email') || c.req.query('accountEmail') || '';
  const serviceType = c.req.query('serviceType') || '';
  if (!accountEmail) return c.json({ ok: false, found: false, error: 'email query is required', missing: ['email'] }, 400);

  try {
    const res = await fetch(`${EMAIL_SERVER}/api/sl/aliases?page=0`);
    const data = await res.json() as any;
    const aliases = Array.isArray(data?.aliases) ? data.aliases : [];
    const result = await resolveEmailAliasFill({ accountEmail, serviceType, aliases });
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, found: false, email: accountEmail, serviceType, emailId: null, pin: null, memo: '', missing: ['email', 'pin'], error: e.message }, 500);
  }
});

let profileAuditProgress: ProfileAuditProgress = createProfileAuditProgress(0);
finishProfileAuditProgress(profileAuditProgress, 'completed', '아직 실행 중인 프로필 검증이 없어요.');

const profileAuditResultsHandler = (c: any) => {
  const store = loadProfileAuditStore();
  return c.json({ ok: true, results: store, progress: profileAuditProgress, updatedAt: new Date().toISOString() });
};
app.get('/profile-audit/results', profileAuditResultsHandler);
app.get('/api/profile-audit/results', profileAuditResultsHandler);

app.get('/profile-audit/progress', (c) => c.json({ ok: true, progress: profileAuditProgress, updatedAt: new Date().toISOString() }));
app.get('/api/profile-audit/progress', (c) => c.json({ ok: true, progress: profileAuditProgress, updatedAt: new Date().toISOString() }));

const profileAuditRowsHandler = async (c: any) => {
  const body = await c.req.json().catch(() => ({})) as any;
  const data = body?.managementData;
  if (!data?.services) return c.json({ ok: false, error: 'managementData.services is required' }, 400);
  const rows = buildProfileAuditRows(data, Array.isArray(body?.manualMembers) ? body.manualMembers : [], loadProfileAuditStore());
  return c.json({ ok: true, rows, summary: summarizeProfileAudit(rows), updatedAt: new Date().toISOString() });
};
app.post('/profile-audit/rows', profileAuditRowsHandler);
app.post('/api/profile-audit/rows', profileAuditRowsHandler);

const profileAuditRunHandler = async (c: any) => {
  const body = await c.req.json().catch(() => ({})) as any;
  const rows = Array.isArray(body?.rows) ? body.rows as ProfileAuditRow[] : [];
  if (rows.length === 0) return c.json({ ok: false, error: 'rows are required' }, 400);

  const targetRows = rows.slice(0, 20);
  profileAuditProgress = createProfileAuditProgress(targetRows.length);
  const store: ProfileAuditStore = loadProfileAuditStore();
  const checkedRows: ProfileAuditRow[] = [];
  try {
    for (let index = 0; index < targetRows.length; index += 1) {
      const row = targetRows[index];
      updateProfileAuditProgress(profileAuditProgress, {
        completed: index,
        currentServiceType: row.serviceType,
        currentAccountEmail: row.accountEmail,
        message: `${index + 1}/${targetRows.length} ${row.serviceType} 검사 중`,
      });
      const rowWithSecret = row as ProfileAuditRow & { keepPasswd?: string; password?: string };
      const result = row.serviceType === '넷플릭스'
        ? await checkNetflixProfiles({
            email: row.accountEmail,
            password: rowWithSecret.keepPasswd || rowWithSecret.password || '',
            expectedPartyCount: row.expectedPartyCount,
            fetchEmailCode: ({ email, requestedAfter }) => fetchNetflixEmailCodeViaEmailServer({ email, requestedAfter, emailServer: EMAIL_SERVER }),
          })
        : await runProfileCheckPlaceholder(row);
      store[profileAuditKey(row.serviceType, row.accountEmail)] = result;
      const { keepPasswd: _keepPasswd, password: _password, ...safeRow } = rowWithSecret;
      checkedRows.push({
        ...safeRow,
        actualProfileCount: result.actualProfileCount,
        checkedAt: result.checkedAt,
        checker: result.checker,
        status: result.status || 'unchecked',
        message: result.message || row.message,
      });
      updateProfileAuditProgress(profileAuditProgress, {
        completed: index + 1,
        currentServiceType: row.serviceType,
        currentAccountEmail: row.accountEmail,
        message: `${index + 1}/${targetRows.length} ${row.serviceType} 검사 완료`,
      });
    }
    saveProfileAuditStore(store);
    finishProfileAuditProgress(profileAuditProgress, 'completed');
    return c.json({ ok: true, checkedRows, results: store, progress: profileAuditProgress, summary: summarizeProfileAudit(checkedRows), updatedAt: new Date().toISOString() });
  } catch (error: any) {
    finishProfileAuditProgress(profileAuditProgress, 'failed', error?.message || '프로필 검증 중 오류가 발생했어요.');
    saveProfileAuditStore(store);
    return c.json({ ok: false, checkedRows, results: store, progress: profileAuditProgress, error: profileAuditProgress.message, summary: summarizeProfileAudit(checkedRows), updatedAt: new Date().toISOString() }, 500);
  }
};
app.post('/profile-audit/run', profileAuditRunHandler);
app.post('/api/profile-audit/run', profileAuditRunHandler);

// ── Email verify 서버(3001) 프록시 라우트 ──────────────────────────────────

app.get("/sl/aliases/:id", async (c) => {
  try {
    const res = await fetch(`${EMAIL_SERVER}/api/sl/aliases/${c.req.param("id")}`);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/sl/aliases/:id/pin/status", async (c) => {
  try {
    const res = await fetch(`${EMAIL_SERVER}/api/sl/aliases/${c.req.param("id")}/pin/status`);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.post("/sl/aliases/:id/pin/verify", async (c) => {
  try {
    const body = await c.req.text();
    const res = await fetch(`${EMAIL_SERVER}/api/sl/aliases/${c.req.param("id")}/pin/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

app.get("/email/list", async (c) => {
  try {
    const alias = c.req.query("alias") || "";
    const limit = c.req.query("limit") || "50";
    const res = await fetch(`${EMAIL_SERVER}/api/email/list?alias=${encodeURIComponent(alias)}&limit=${limit}`);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) { return c.json({ emails: [], error: e.message }, 500); }
});

app.get("/email/uid/:uid", async (c) => {
  try {
    const res = await fetch(`${EMAIL_SERVER}/api/email/uid/${c.req.param("uid")}`);
    const data = await res.json();
    return c.json(data, res.status as any);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 채팅방 목록 (모든 활성 딜 + unread 상태)
app.get('/chat/rooms', async (c) => {
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ error: 'Session keeper 쿠키 없음' }, 400);
  const cookieStr = buildCookieStr(cookies);
  const headers = { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr/lender/deal/listAfterUsing' };

  try {
    // rate-limit 백오프 중이면 캐시된 결과 즉시 반환
    if (Date.now() < _rateLimitUntil && _chatRoomsCache) {
      console.log("[chat/rooms] rate-limit 백오프 중 — 캐시 반환");
      return c.json({ ..._chatRoomsCache, fromCache: true });
    }

    // 여러 페이지 로드 (최대 5페이지 = 250건)
    const allDeals: any[] = [];
    for (let page = 1; page <= 2; page++) {
      const resp = await rateLimitedFetch(
        `https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=${page}&rows=500`,
        { headers, redirect: 'manual' }
      );
      if (resp.status === 429) {
        // rate-limit 백오프 — 캐시 반환 or 빈 배열
        if (_chatRoomsCache) {
          console.log("[chat/rooms] rate-limit 429 — 캐시 반환");
          return c.json({ ..._chatRoomsCache, fromCache: true });
        }
        return c.json({ rooms: [], totalRooms: 0, unreadCount: 0, fromCache: false, rateLimited: true, updatedAt: new Date().toISOString() });
      }
      if (resp.status === 302 || resp.status === 301) return c.json({ error: '쿠키가 만료됐어요 (302 리다이렉트 — rate-limit 아님)', code: 'COOKIE_EXPIRED' }, 401);
      const r = await safeJson(resp);
      const deals = r.data?.data?.lenderDeals || [];
      if (deals.length === 0) break;
      allDeals.push(...deals);
    }

    // 각 room의 lastMessage 가져오기 (병렬)
    const roomsWithMessages = await Promise.all(allDeals
      .filter((d: any) => d.chatRoomUuid)
      .map(async (d: any) => {
        const room = {
          dealUsid: d.dealUsid,
          chatRoomUuid: d.chatRoomUuid,
          borrowerName: d.borrowerName?.trim(),
          borrowerThumbnail: d.borrowerThumbnailImageUrl,
          productType: d.productTypeString,
          productName: d.productName,
          dealStatus: d.dealStatus,
          statusName: d.lenderDealStatusName,
          remainderDays: d.remainderDays,
          endDateTime: d.endDateTime,
          lenderChatUnread: d.lenderChatUnread || d.dealDetail?.lenderChatUnread || false,
          price: d.price,
          keepAcct: d.keepAcct,
          lastMessage: undefined as string | undefined,
        };

        // 최신 메시지 조회 (첫 페이지만)
        try {
          const msgResp = await rateLimitedFetch(
            `https://graytag.co.kr/ws/chat/findChats?uuid=${d.chatRoomUuid}&page=1`,
            { headers, redirect: 'manual', signal: AbortSignal.timeout(2000) }
          );
          if (msgResp.ok) {
            const msgData = await safeJson(msgResp);
            const messages = msgData.data?.data?.chats || [];
            // 가장 최신 메시지 찾기 (isInfo가 아닌, 실제 유저 메시지)
            const userMsg = messages.find((m: any) => !m.isInfo);
            if (userMsg) {
              room.lastMessage = userMsg.message
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]+>/g, '')
                .trim()
                .slice(0, 50);
            }
          }
        } catch (e) {
          // 실패해도 계속 진행
        }

        return room;
      })
    );

    const rooms = roomsWithMessages;

    const result = {
      rooms,
      totalRooms: rooms.length,
      unreadCount: rooms.filter((r: any) => r.lenderChatUnread).length,
      updatedAt: new Date().toISOString(),
    };
    _chatRoomsCache = result; // 캐시 저장
    return c.json(result);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 특정 채팅방 메시지 조회 (무한 스크롤)
app.get('/chat/messages/:uuid', async (c) => {
  const { uuid } = c.req.param();
  const page = parseInt(c.req.query('page') || '1');
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ error: 'Session keeper 쿠키 없음' }, 400);
  const cookieStr = buildCookieStr(cookies);

  try {
    const resp = await rateLimitedFetch(
      `https://graytag.co.kr/ws/chat/findChats?uuid=${uuid}&page=${page}`,
      {
        headers: {
          ...BASE_HEADERS,
          Cookie: cookieStr,
          Referer: `https://graytag.co.kr/chat/${uuid}`,
        },
        redirect: 'manual',
      }
    );
    if (resp.status === 302 || resp.status === 301) return c.json({ error: '쿠키 만료', code: 'COOKIE_EXPIRED' }, 401);
    const r = await safeJson(resp);
    if (!r.ok) return c.json({ error: '메시지 조회 실패' }, 500);

    const messages = (r.data?.data || r.data || []).map((m: any) => ({
      message: m.message,
      registeredDateTime: m.registeredDateTime,
      isOwned: m.owned,
      isInfo: m.informationMessage,
      isRead: m.read,
      messageType: m.messageType,
    }));

    return c.json({ uuid, page, messages, hasMore: messages.length >= 20 });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 전체 채팅 폴링 (새 메시지 감지)
app.get('/chat/poll', async (c) => {
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ error: 'Session keeper 쿠키 없음' }, 400);
  const cookieStr = buildCookieStr(cookies);
  const headers = { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr/lender/deal/listAfterUsing' };

  try {
    // 사용중 + 사용전(배송중/상품확인중 등) 모두 폴링 → 모든 클라이언트 자동응답
    const [afterResp, beforeResp] = await Promise.all([
      rateLimitedFetch('https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=500',
        { headers, redirect: 'manual' }),
      rateLimitedFetch('https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=500',
        { headers: { ...headers, Referer: 'https://graytag.co.kr/lender/deal/listBeforeUsing' }, redirect: 'manual' }),
    ]);
    if (afterResp.status === 302 || afterResp.status === 301) return c.json({ error: '쿠키 만료' }, 401);
    const afterR = await safeJson(afterResp);
    const beforeR = await safeJson(beforeResp);
    const afterDeals = afterR.data?.data?.lenderDeals || [];
    const beforeDeals = beforeR.data?.data?.lenderDeals || [];
    const allDeals = [...afterDeals, ...beforeDeals];

    // chatRoomUuid 중복 제거
    const seen = new Set<string>();
    const unreadRooms = allDeals
      .filter((d: any) => {
        if (!d.chatRoomUuid) return false;
        if (seen.has(d.chatRoomUuid)) return false;
        seen.add(d.chatRoomUuid);
        return d.lenderChatUnread || d.dealDetail?.lenderChatUnread;
      })
      .map((d: any) => ({
        dealUsid: d.dealUsid,
        chatRoomUuid: d.chatRoomUuid,
        borrowerName: d.borrowerName?.trim(),
        productType: d.productTypeString,
      }));

    return c.json({
      unreadRooms,
      unreadCount: unreadRooms.length,
      totalDeals: allDeals.length,
      polledAt: new Date().toISOString(),
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// STOMP를 통한 메시지 전송 (stomp-sender.cjs 사용)
app.post('/chat/send', async (c) => {
  const requestId = auditRequestId(c);
  const body = await c.req.json() as any;
  const { chatRoomUuid, dealUsid, message } = body;
  if (!chatRoomUuid || !message) {
    writeAudit({ actor: 'admin', action: 'chat.send', targetType: 'chatRoom', targetId: chatRoomUuid || '', summary: 'chat send blocked: missing chatRoomUuid or message', result: 'blocked', requestId, details: { dealUsid, hasMessage: Boolean(message) } });
    return c.json({ error: 'chatRoomUuid와 message 필수' }, 400);
  }

  try {
    const cp = await import('node:child_process');
    const args = ['/home/ubuntu/graytag-session/stomp-sender.cjs', chatRoomUuid, message];
    if (dealUsid) args.push(dealUsid);
    const cmd = 'node ' + args.map(a => JSON.stringify(a)).join(' ');
    const result = cp.execSync(cmd, { timeout: 20000 }).toString().trim();
    const parsed = JSON.parse(result);
    writeAudit({ actor: 'admin', action: 'chat.send', targetType: 'chatRoom', targetId: chatRoomUuid, summary: `chat message sent${dealUsid ? ` for deal ${dealUsid}` : ''}`, result: parsed?.ok === false ? 'error' : 'success', requestId, details: { dealUsid, response: parsed } });
    return c.json(parsed);
  } catch (e: any) {
    const error = e.stderr?.toString().slice(0, 200) || e.message?.slice(0, 200) || 'send failed';
    writeAudit({ actor: 'admin', action: 'chat.send', targetType: 'chatRoom', targetId: chatRoomUuid, summary: 'chat send failed', result: 'error', requestId, details: { dealUsid, error } });
    return c.json({ ok: false, error }, 500);
  }
});


// ─── 상품 삭제 (OnSale 상태만) ────────────────────────────────
app.post('/my/delete-products', async (c) => {
  const requestId = auditRequestId(c);
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) {
    writeAudit({ actor: 'admin', action: 'my.delete-products', targetType: 'product', targetId: '', summary: 'delete products blocked: missing JSESSIONID', result: 'blocked', requestId, details: body });
    return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);
  }
  const { usids } = body; // string[]
  if (!usids || !Array.isArray(usids) || usids.length === 0) {
    writeAudit({ actor: 'admin', action: 'my.delete-products', targetType: 'product', targetId: '', summary: 'delete products blocked: missing usids', result: 'blocked', requestId, details: body });
    return c.json({ error: 'usids 배열이 필요합니다' }, 400);
  }

  const cookieStr = buildCookieStr(cookies);
  const results: any[] = [];

  for (const usid of usids) {
    try {
      const resp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/removeProduct', {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'Cookie': cookieStr,
          'Content-Type': 'application/json;charset=UTF-8',
          'Referer': `https://graytag.co.kr/lender/product/setting?productUsid=${usid}`,
        },
        body: JSON.stringify({ usid }),
        redirect: 'manual',
      });

      const r = await safeJson(resp);
      if (resp.status === 302 || resp.status === 301) {
        results.push({ usid, ok: false, error: '쿠키 만료 — 다시 시도해주세요' });
      } else if (r.ok && (r.data?.succeeded || r.data?.ok)) {
        results.push({ usid, ok: true });
      } else {
        const msg = r.data?.message || r.data?.error || (r.html ? '상태 확인 불가 (HTML 응답)' : '삭제 실패');
        results.push({ usid, ok: false, error: msg });
      }
    } catch (e: any) {
      results.push({ usid, ok: false, error: e.message });
    }

    if (usids.indexOf(usid) < usids.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const result = successCount === usids.length ? 'success' : (successCount > 0 ? 'error' : 'error');
  writeAudit({
    actor: 'admin',
    action: 'my.delete-products',
    targetType: 'product',
    targetId: usids.join(','),
    summary: `delete products: ${successCount}/${usids.length} succeeded`,
    result,
    requestId,
    details: { usids, results },
  });
  return c.json({ results, successCount, totalCount: usids.length });
});

app.get('/ping', (c) => c.json({ ok: true }));

// ─── Seller 통합 상태판 (읽기 전용, 민감값 제외) ───────────────
const KNOWN_DEALS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/known-deals.json';
const POLL_DAEMON_STATUS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/poll-daemon-status.json';
const AUTO_REPLY_LOG_PATH = '/home/ubuntu/graytag-session/auto-reply-rest-api.log';

function readJsonFile<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch { return null; }
}

function safeFileMtime(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return statSync(path).mtime.toISOString();
  } catch { return null; }
}

function countKnownDeals(raw: any): number {
  if (!raw || typeof raw !== 'object') return 0;
  return Object.keys(raw).filter((key) => !key.startsWith('ext_warned_')).length;
}

function buildSellerStatus() {
  const warnings: string[] = [];

  const sessionRaw = readJsonFile<any>('/tmp/graytag-session-status.json');
  const sessionStatus = typeof sessionRaw?.status === 'string' ? sessionRaw.status : 'unknown';
  const sessionLastCheck = sessionRaw?.lastCheck || sessionRaw?.lastSuccess || null;
  const sessionOk = sessionStatus === 'ok' || ((sessionRaw?.consecutiveAuthFails ?? 0) < 2 && !!loadSessionCookies());
  if (!sessionRaw) warnings.push('Graytag 세션 상태 파일 없음');
  else if (!sessionOk) warnings.push(`Graytag 세션 상태 확인 필요: ${sessionStatus}`);

  const knownDealsRaw = readJsonFile<Record<string, string>>(KNOWN_DEALS_PATH);
  const knownDeals = countKnownDeals(knownDealsRaw);
  const knownDealsMtime = safeFileMtime(KNOWN_DEALS_PATH);
  const pollRaw = readJsonFile<any>(POLL_DAEMON_STATUS_PATH);
  const pollLastSuccess = pollRaw?.lastSuccess || knownDealsMtime;
  const pollLastError = pollRaw?.lastError || null;
  const pollConsecutiveFailures = Number(pollRaw?.consecutiveFailures ?? 0);
  const pollStaleMs = Number(process.env.SELLER_STATUS_POLL_STALE_MS || 10 * 60 * 1000);
  const pollLastSuccessMs = pollLastSuccess ? Date.parse(pollLastSuccess) : NaN;
  const pollIsStale = Number.isFinite(pollLastSuccessMs) && Date.now() - pollLastSuccessMs > pollStaleMs;
  const pollOk = (pollRaw?.ok === true || (!!knownDealsMtime && pollConsecutiveFailures === 0 && !pollLastError)) && !pollIsStale;
  if (!pollRaw && !knownDealsMtime) warnings.push('PollDaemon 상태 파일/known-deals 파일 없음');
  if (pollLastError) warnings.push('PollDaemon 최근 오류 있음');
  if (pollIsStale) warnings.push('PollDaemon 성공 기록 오래됨');

  const undercutterState = readJsonFile<any>('/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/undercutter-state.json');
  const undercutterLog = loadUndercutterLog();
  const lastUndercutterLog = undercutterLog[undercutterLog.length - 1];

  const autoReplyCfg = loadAutoReplyConfig();
  const autoReplyLastLogAt = safeFileMtime(AUTO_REPLY_LOG_PATH);

  const manualMembers = loadManualMembers().length;

  return {
    ok: warnings.length === 0,
    generatedAt: new Date().toISOString(),
    session: {
      ok: sessionOk,
      status: sessionStatus,
      lastCheck: sessionLastCheck,
    },
    pollDaemon: {
      ok: pollOk,
      lastSuccess: pollLastSuccess,
      lastError: pollLastError,
      consecutiveFailures: pollConsecutiveFailures,
    },
    undercutter: {
      enabled: undercutterState?.on === true,
      lastRun: undercutterState?.lastRun || lastUndercutterLog?.timestamp || null,
      intervalMinutes: Number(undercutterState?.intervalMinutes ?? 5),
    },
    autoReply: {
      enabled: autoReplyCfg.enabled === true,
      lastLogAt: autoReplyLastLogAt,
    },
    data: {
      knownDeals,
      manualMembers,
    },
    warnings,
  };
}

async function notifySellerStatusWarnings(status: ReturnType<typeof buildSellerStatus>): Promise<void> {
  const criticalWarnings = status.warnings.filter((warning) => /PollDaemon|Graytag 세션/.test(warning));
  for (const warning of criticalWarnings) {
    const key = 'seller-status-' + warning.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '-').slice(0, 120);
    const result = await sendSellerAlert({
      key,
      title: 'Seller status warning',
      body: warning,
      severity: /세션|오류|오래됨/.test(warning) ? 'critical' : 'warning',
    });
    if (result.reason === 'failed') console.error('[seller-status] 장애 알림 전송 실패');
    writeAudit({ actor: 'system', action: 'alert.send', targetType: 'seller-status', targetId: key, summary: `seller status alert: ${warning}`, result: result.reason === 'failed' ? 'error' : 'success', requestId: `alert-${Date.now()}`, details: result });
  }
}

async function sellerStatusHandler(c: any) {
  const status = buildSellerStatus();
  await notifySellerStatusWarnings(status);
  return c.json(status);
}

app.get('/seller/status', sellerStatusHandler);
// apiApp.request('/api/...') 테스트와 server.ts의 app.route('/api', apiApp) 양쪽을 모두 안전하게 지원
app.get('/api/seller/status', sellerStatusHandler);

const priceSafetyGetHandler = (c: any) => c.json(loadPriceSafetyConfig());
const priceSafetyPostHandler = async (c: any) => {
  const requestId = auditRequestId(c);
  const before = loadPriceSafetyConfig();
  const body = await c.req.json().catch(() => ({}));
  try {
    const after = savePriceSafetyConfig(body);
    writeAudit({ actor: 'admin', action: 'price-safety.update', targetType: 'config', targetId: 'price-safety', summary: 'price safety config updated', result: 'success', requestId, before, after, details: body });
    return c.json(after);
  } catch (e: any) {
    writeAudit({ actor: 'admin', action: 'price-safety.update', targetType: 'config', targetId: 'price-safety', summary: 'price safety config update failed', result: 'error', requestId, before, details: { body, error: e?.message } });
    throw e;
  }
};
const priceSafetyPreviewHandler = async (c: any) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(previewPriceChange(body));
};

app.get('/price-safety', priceSafetyGetHandler);
app.get('/api/price-safety', priceSafetyGetHandler);
app.post('/price-safety', priceSafetyPostHandler);
app.post('/api/price-safety', priceSafetyPostHandler);
app.post('/price-safety/preview', priceSafetyPreviewHandler);
app.post('/api/price-safety/preview', priceSafetyPreviewHandler);

const safeModeGetHandler = (c: any) => c.json(loadSafeModeConfig());
const safeModeUpdateHandler = async (c: any) => {
  const requestId = auditRequestId(c);
  const before = loadSafeModeConfig();
  const body = await c.req.json().catch(() => ({}));
  try {
    const after = saveSafeModeConfig({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : before.enabled,
      reason: typeof body.reason === 'string' ? body.reason : before.reason,
      updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : 'admin',
    });
    writeAudit({
      actor: 'admin',
      action: 'safe-mode.update',
      targetType: 'config',
      targetId: 'safe-mode',
      summary: `safe mode ${after.enabled ? 'enabled' : 'disabled'}`,
      result: 'success',
      requestId,
      before,
      after,
      details: { enabled: after.enabled, reason: after.reason, updatedBy: after.updatedBy },
    });
    return c.json(after);
  } catch (e: any) {
    writeAudit({
      actor: 'admin',
      action: 'safe-mode.update',
      targetType: 'config',
      targetId: 'safe-mode',
      summary: 'safe mode update failed',
      result: 'error',
      requestId,
      before,
      details: { body, error: e?.message },
    });
    throw e;
  }
};

app.get('/safe-mode', safeModeGetHandler);
app.get('/api/safe-mode', safeModeGetHandler);
app.post('/safe-mode', safeModeUpdateHandler);
app.post('/api/safe-mode', safeModeUpdateHandler);
app.put('/safe-mode', safeModeUpdateHandler);
app.put('/api/safe-mode', safeModeUpdateHandler);

export default app;


// ─── 내 판매중(OnSale) 상품 목록 조회 ─────────────────────────
app.post('/my/onsale-products', async (c) => {
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);

  const cookieStr = buildCookieStr(cookies);
  const headers = { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr/lender/deal/list' };

  // 쿠키 유효성 확인
  const test = await rateLimitedFetch('https://graytag.co.kr/ws/borrower/findBorrowerDeals?finishedDealIncluded=false&page=1&rows=1', {
    headers: { ...headers }, redirect: 'manual',
  });
  if (test.status === 302 || test.status === 301)
    return c.json({ error: '쿠키가 만료됐어요.', code: 'COOKIE_EXPIRED' }, 401);

  try {
    const allDeals: any[] = [];
    for (let page = 1; page <= 2; page++) {
      const resp = await rateLimitedFetch(
        buildFinishedDealsUrl('before', page, 500, false),
        { headers, redirect: 'manual' }
      );
      const r = await safeJson(resp);
      const deals = r.data?.data?.lenderDeals || [];
      if (deals.length === 0) break;
      allDeals.push(...deals);
    }

    const onSale = allDeals
      .filter((d: any) => d.dealStatus === 'OnSale')
      .map((d: any) => ({
        productUsid: d.productUsid,
        productName: d.productName,
        productType: d.productTypeString,
        price: d.price,
        priceNum: parseInt((d.price || '0').replace(/[^0-9]/g, '') || '0'),
        endDateTime: d.endDateTime,
        remainderDays: d.remainderDays,
        keepAcct: d.keepAcct || '',
        keepPasswd: d.keepPasswd || '',
      }));

    return c.json({
      products: onSale,
      totalCount: onSale.length,
      cookieSource: body?.JSESSIONID?.trim() ? 'manual' : 'session-keeper',
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// ─── 상품 가격 일괄 변경 ─────────────────────────────────────
// ─── 상품 setting 페이지에서 기존값 파싱 ─────────────────────
async function fetchProductSettings(cookieStr: string, productUsid: string) {
  const settingUrl = `https://graytag.co.kr/lender/product/setting?productUsid=${productUsid}`;
  const resp = await rateLimitedFetch(settingUrl, {
    headers: { ...BASE_HEADERS, Cookie: cookieStr, Accept: 'text/html', Referer: 'https://graytag.co.kr/lender/deal/list' },
    redirect: 'manual',
  });
  if (!resp.ok && resp.status !== 200) return null;
  const html = await resp.text();

  const extract = (pattern: RegExp) => { const m = html.match(pattern); return m ? m[1] : ''; };

  const name = extract(/class="[^"]*product-name[^"]*"[^>]*value="([^"]*?)"/);
  const price = extract(/class="[^"]*price-input[^"]*"[^>]*value="([^"]*?)"/);
  const endDateTime = extract(/id="endDateTime"[^>]*value="([^"]*?)"/);
  const netflixSeatCount = extract(/id="netflixSeatCount"[^>]*value="([^"]*?)"/);
  const productCountryString = extract(/id="productCountryString"[^>]*value="([^"]*?)"/);

  // sellingGuide는 class="selling-guide" textarea에 있음 (id="sellingGuide"는 빈값)
  const sgMatch = html.match(/class="[^"]*selling-guide[^"]*"[^>]*>([\s\S]*?)<\/textarea>/);
  const sellingGuideRaw = sgMatch ? sgMatch[1].trim() : '';
  // HTML entities decode
  const sellingGuide = sellingGuideRaw
    .replace(/&#34;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  // oneLineCopy
  const copy = extract(/id="oneLineCopy"[^>]*value="([^"]*?)"/) || extract(/value="([^"]*?)"[^>]*id="oneLineCopy"/);

  return { name, price, endDateTime, netflixSeatCount, productCountryString, sellingGuide, copy };
}

app.post('/my/update-price', async (c) => {
  const requestId = auditRequestId(c);
  const body = await c.req.json() as any;
  const cookies = resolveCookies(body);
  if (!cookies) {
    writeAudit({ actor: 'admin', action: 'my.update-price', targetType: 'product', targetId: '', summary: 'update price blocked: missing JSESSIONID', result: 'blocked', requestId, details: body });
    return c.json({ error: 'JSESSIONID가 필요합니다' }, 400);
  }
  const { products } = body; // [{ usid, price }]
  if (!products || !Array.isArray(products) || products.length === 0) {
    writeAudit({ actor: 'admin', action: 'my.update-price', targetType: 'product', targetId: '', summary: 'update price blocked: missing products', result: 'blocked', requestId, details: body });
    return c.json({ error: 'products 배열이 필요합니다' }, 400);
  }

  const cookieStr = buildCookieStr(cookies);
  const results: any[] = [];

  for (const item of products) {
    if (!item.usid || !item.price) {
      results.push({ usid: item.usid, ok: false, error: 'usid와 price 필수' });
      continue;
    }
    try {
      const nextPrice = Number(String(item.price).replace(/[^0-9]/g, '') || '0');
      const providedCurrentPrice = item.currentPrice ?? item.originalPrice ?? item.current_price;
      if (providedCurrentPrice !== undefined && providedCurrentPrice !== null && providedCurrentPrice !== '') {
        const safety = assertPriceChangeAllowed({
          productId: item.productId ?? item.usid,
          title: item.title ?? item.name,
          currentPrice: providedCurrentPrice,
          nextPrice,
        });
        if (!safety.allowed) {
          results.push({ usid: item.usid, ok: false, error: 'PRICE_SAFETY_BLOCKED', ...safety });
          continue;
        }
      }

      // 1) 기존 상품 정보를 setting 페이지에서 파싱
      const existing = await fetchProductSettings(cookieStr, item.usid);

      if (providedCurrentPrice === undefined || providedCurrentPrice === null || providedCurrentPrice === '') {
        const safety = assertPriceChangeAllowed({
          productId: item.productId ?? item.usid,
          title: item.title ?? item.name ?? existing?.name,
          currentPrice: existing?.price || 0,
          nextPrice,
        });
        if (!safety.allowed) {
          results.push({ usid: item.usid, ok: false, error: 'PRICE_SAFETY_BLOCKED', ...safety });
          continue;
        }
      }

      // 2) 기존값 유지 + price 교체 (name이 넘어오면 name도 교체)
      const payload: any = {
        usid: item.usid,
        name: item.name || existing?.name || '',
        copy: existing?.copy || '',
        sellingGuide: existing?.sellingGuide || '',
        endDate: existing?.endDateTime || '',
        netflixSeatCount: existing?.netflixSeatCount || '0',
        productCountryString: existing?.productCountryString || '',
        price: String(nextPrice),
      };

      const resp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/updateProductInfo', {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'Cookie': cookieStr,
          'Content-Type': 'application/json;charset=UTF-8',
          'Referer': `https://graytag.co.kr/lender/product/setting?productUsid=${item.usid}`,
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
      });

      const r = await safeJson(resp);
      if (r.ok && r.data?.succeeded) {
        recordSuccessfulPriceDecrease({
          productId: item.productId ?? item.usid,
          title: item.title ?? item.name ?? existing?.name,
          currentPrice: providedCurrentPrice ?? existing?.price ?? 0,
          nextPrice,
        });
        results.push({ usid: item.usid, ok: true });
      } else {
        results.push({ usid: item.usid, ok: false, error: r.data?.message || '수정 실패' });
      }
    } catch (e: any) {
      results.push({ usid: item.usid, ok: false, error: e.message });
    }

    // 연속 호출 딜레이
    if (products.indexOf(item) < products.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const auditResult = auditResultFromResults(results);
  writeAudit({
    actor: 'admin',
    action: 'my.update-price',
    targetType: 'product',
    targetId: products.map((p: any) => p?.usid).filter(Boolean).join(','),
    summary: `update price: ${successCount}/${products.length} succeeded`,
    result: auditResult,
    requestId,
    details: { products, results },
  });
  return c.json({ results, successCount, totalCount: products.length });
});

// ─── 일당 가격 설정 (Daily Rate Config) ──────────────────────
const DAILY_RATES_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/daily-rates.json';
const SYNC_LOG_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/sync-log.json';

function loadDailyRates(): Record<string, number> {
  try {
    if (!existsSync(DAILY_RATES_PATH)) return {};
    return JSON.parse(readFileSync(DAILY_RATES_PATH, 'utf8'));
  } catch { return {}; }
}

function saveDailyRates(rates: Record<string, number>) {
  const dir = DAILY_RATES_PATH.replace(/\/[^/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DAILY_RATES_PATH, JSON.stringify(rates, null, 2), 'utf8');
}

function appendSyncLog(entry: any) {
  try {
    const dir = SYNC_LOG_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    let logs: any[] = [];
    if (existsSync(SYNC_LOG_PATH)) {
      try { logs = JSON.parse(readFileSync(SYNC_LOG_PATH, 'utf8')); } catch {}
    }
    logs.push(entry);
    // Keep last 100 entries
    if (logs.length > 100) logs = logs.slice(-100);
    writeFileSync(SYNC_LOG_PATH, JSON.stringify(logs, null, 2), 'utf8');
  } catch {}
}

// GET daily rates
app.get('/daily-rates', (c) => {
  return c.json(loadDailyRates());
});

// POST update daily rates
app.post('/daily-rates', async (c) => {
  const body = await c.req.json() as Record<string, number>;
  const current = loadDailyRates();
  const merged = { ...current, ...body };
  saveDailyRates(merged);
  return c.json({ ok: true, rates: merged });
});

// Auto-sync: recalc all OnSale product prices = dailyRate * remainderDays
app.post('/auto-sync-prices', async (c) => {
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ error: 'Session keeper 쿠키 없음' }, 500);

  const cookieStr = buildCookieStr(cookies);
  const headers = { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr/lender/deal/list' };

  // Fetch all OnSale products
  const allDeals: any[] = [];
  for (let page = 1; page <= 2; page++) {
    const resp = await rateLimitedFetch(
      `https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=${page}&rows=500`,
      { headers, redirect: 'manual' }
    );
    if (resp.status === 302) return c.json({ error: '쿠키 만료', code: 'COOKIE_EXPIRED' }, 401);
    const r = await safeJson(resp);
    const deals = r.data?.data?.lenderDeals || [];
    if (deals.length === 0) break;
    allDeals.push(...deals);
  }

  const onSale = allDeals.filter((d: any) => d.dealStatus === 'OnSale');
  const results: any[] = [];
  let updated = 0;
  let skipped = 0;

  for (const deal of onSale) {
    const svcType = deal.productTypeString || '';
    const remainDays = deal.remainderDays || 0;
    const currentPrice = parseInt((deal.price || '0').replace(/[^0-9]/g, '') || '0');

    if (remainDays <= 0) {
      results.push({ usid: deal.productUsid, svc: svcType, action: 'skip', reason: '잔여일 0' });
      skipped++;
      continue;
    }

    // 일당가는 graytag API에서 내려오는 pricePerDay 그대로 사용 (절대 역산하지 않음)
    const pricePerDayStr = deal.pricePerDay || '';
    const dailyRate = parseInt(pricePerDayStr.replace(/[^0-9]/g, '') || '0');
    if (dailyRate <= 0) {
      results.push({ usid: deal.productUsid, svc: svcType, action: 'skip', reason: '일당 정보 없음', current: currentPrice });
      skipped++;
      continue;
    }

    // 새 가격 = 기존 일당(고정) × 현재 잔여일
    const correctPrice = dailyRate * remainDays;

    if (correctPrice === currentPrice) {
      results.push({ usid: deal.productUsid, svc: svcType, action: 'skip', reason: '이미 일치', current: currentPrice, correct: correctPrice, daily: dailyRate });
      skipped++;
      continue;
    }

    if (correctPrice < 1000) {
      results.push({ usid: deal.productUsid, svc: svcType, action: 'skip', reason: '최소가격 미만', correct: correctPrice, daily: dailyRate });
      skipped++;
      continue;
    }

    // Update price
    try {
      const existing = await fetchProductSettings(cookieStr, deal.productUsid);
      const payload: any = {
        usid: deal.productUsid,
        name: existing?.name || '',
        copy: existing?.copy || '',
        sellingGuide: existing?.sellingGuide || '',
        endDate: existing?.endDateTime || '',
        netflixSeatCount: existing?.netflixSeatCount || '0',
        productCountryString: existing?.productCountryString || '',
        price: String(correctPrice),
      };

      const resp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/updateProductInfo', {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'Cookie': cookieStr,
          'Content-Type': 'application/json;charset=UTF-8',
          'Referer': `https://graytag.co.kr/lender/product/setting?productUsid=${deal.productUsid}`,
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
      });

      const r = await safeJson(resp);
      if (r.ok && r.data?.succeeded) {
        results.push({ usid: deal.productUsid, svc: svcType, action: 'updated', from: currentPrice, to: correctPrice, daily: dailyRate, days: remainDays });
        updated++;
      } else {
        results.push({ usid: deal.productUsid, svc: svcType, action: 'error', error: r.data?.message || '수정 실패' });
      }
    } catch (e: any) {
      results.push({ usid: deal.productUsid, svc: svcType, action: 'error', error: e.message });
    }

    // Delay between API calls
    await new Promise(r => setTimeout(r, 500));
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    totalOnSale: onSale.length,
    updated,
    skipped,
    results,
  };
  appendSyncLog(logEntry);

  return c.json(logEntry);
});

// GET sync log
app.get('/sync-log', (c) => {
  try {
    if (!existsSync(SYNC_LOG_PATH)) return c.json([]);
    return c.json(JSON.parse(readFileSync(SYNC_LOG_PATH, 'utf8')));
  } catch { return c.json([]); }
});

// ─── keepMemo 일괄 업데이트 ──────────────────────────────────
app.post('/bulk-update-keepmemo', async (c) => {
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ error: 'Session keeper 쿠키 없음' }, 500);
  const cookieStr = buildCookieStr(cookies);

  // 1) 모든 alias + pin 데이터 로드
  let aliases: any[] = [];
  try {
    const aliasRes = await fetch(`${EMAIL_SERVER}/api/sl/aliases?page=0`);
    const aliasData = await aliasRes.json() as any;
    aliases = aliasData.aliases || [];
  } catch {}

  // email -> { aliasId, pin } 맵핑 (3001이 pin 포함해서 반환)
  const emailMap: Record<string, { aliasId: number | string; pin: string }> = {};
  for (const a of aliases) {
    const email = a.email || '';
    const id = a.id;
    const pin = a.pin || '';
    emailMap[email] = { aliasId: id, pin };
  }

  // 2) 모든 판매중+이용중 게시물 조회
  const headers = { ...BASE_HEADERS, Cookie: cookieStr, Referer: 'https://graytag.co.kr/lender/deal/list' };
  const allDeals: any[] = [];

  // OnSale (판매중)
  for (let page = 1; page <= 2; page++) {
    const resp = await rateLimitedFetch(
      `https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=${page}&rows=500`,
      { headers, redirect: 'manual' }
    );
    const r = await safeJson(resp);
    const deals = r.data?.data?.lenderDeals || [];
    if (deals.length === 0) break;
    allDeals.push(...deals);
  }

  // AfterUsing (이용중)
  for (let page = 1; page <= 2; page++) {
    const resp = await rateLimitedFetch(
      `https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=${page}&rows=500`,
      { headers, redirect: 'manual' }
    );
    const r = await safeJson(resp);
    const deals = r.data?.data?.lenderDeals || [];
    if (deals.length === 0) break;
    allDeals.push(...deals);
  }

  // 3) keepAcct가 있는 게시물만 대상
  const targets = allDeals.filter(d =>
    d.keepAcct?.trim() &&
    ['OnSale', 'Using', 'UsingNearExpiration', 'Delivered', 'Delivering', 'DeliveredAndCheckPrepaid'].includes(d.dealStatus)
  );

  const newTemplate = (emailId: string | number, pin: string) => {
    return `✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!! ✅\n로그인 시도 간 필요한 이메일 코드는 아래 사이트에서 언제든지 셀프인증 가능합니다!\nhttps://email-verify.xyz/email/mail/${emailId}\n사이트에서 필요한 핀번호는 : ${pin}입니다!\n\n프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!\n만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다! 예)홍길동 또는 홍*동\n만약, 접속 시 기본 프로필 1개만  있거나 자리가 꽉 찼는데 기본 프로필이 있다면 그걸 먼저 수정하고 사용하시면 되겠습니다!\n\n🎬 성인인증 관련 🎬\n성인인증은 안된 상태로 계정이 전달되므로, 필요시에 인증이 안돼있는 경우, 인증 직접 하셔야 합니다!\n\n즐거운 시청되세요!`;
  };

  const results: any[] = [];
  let updated = 0;
  let skipped = 0;

  for (const deal of targets) {
    const keepAcct = deal.keepAcct.trim();
    const keepPasswd = deal.keepPasswd || '';
    const mapping = emailMap[keepAcct];

    if (!mapping || !mapping.aliasId) {
      results.push({ usid: deal.productUsid, svc: deal.productTypeString, email: keepAcct, action: 'skip', reason: 'alias 매핑 없음' });
      skipped++;
      continue;
    }

    const memo = newTemplate(mapping.aliasId, mapping.pin || '(미설정)');
    const currentMemo = deal.keepMemo || '';

    // 이미 새 템플릿인지 확인 (즐거운 시청 포함 여부)
    if (currentMemo.includes('즐거운 시청되세요!')) {
      results.push({ usid: deal.productUsid, svc: deal.productTypeString, email: keepAcct, action: 'skip', reason: '이미 최신' });
      skipped++;
      continue;
    }

    try {
      const payload = {
        productUsid: deal.productUsid,
        keepAcct,
        keepPasswd,
        keepMemo: sanitizeForGraytag(memo),
      };

      const resp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/updateProductKeepAcct', {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'Cookie': cookieStr,
          'Referer': `https://graytag.co.kr/lender/product/keepAcctSetting?productUsid=${deal.productUsid}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
      });

      const r = await safeJson(resp);
      if (r.ok && r.data?.succeeded) {
        results.push({ usid: deal.productUsid, svc: deal.productTypeString, email: keepAcct, action: 'updated' });
        updated++;
      } else {
        results.push({ usid: deal.productUsid, svc: deal.productTypeString, email: keepAcct, action: 'error', error: r.data?.message || '실패' });
      }
    } catch (e: any) {
      results.push({ usid: deal.productUsid, svc: deal.productTypeString, email: keepAcct, action: 'error', error: e.message });
    }

    await new Promise(r => setTimeout(r, 400));
  }

  return c.json({ totalTargets: targets.length, updated, skipped, results });
});

// ─── AI 자동 응답 (PicoClaw / OpenAI) ──────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const SYSTEM_PROMPT = `당신은 "그레이택(Graytag)" OTT 계정 공유 플랫폼의 파티장(계정 소유자) 측 고객 응대 AI 어시스턴트입니다.
당신은 파티장이 파티원(고객)에게 보내는 메시지를 대신 생성합니다.

## 서비스 개요
- 그레이택은 넷플릭스, 디즈니+, 웨이브, 티빙, 왓챠 등 OTT 계정을 공유하는 파티 매칭 플랫폼
- "파티장"이 계정을 등록 → "파티원"이 일정 금액을 내고 함께 사용
- 파티원은 계정 정보(이메일/비밀번호)와 "전달 메모"를 통해 안내받음

## 우리 운영 방식 (중요!)

### 계정 구조
- 하나의 OTT 계정(이메일)에 여러 파티원이 프로필을 나눠 사용
- 비밀번호는 모든 계정 동일: 절대 채팅에 직접 알려주지 말 것 → "전달 메모를 확인해주세요"
- 이메일은 SimpleLogin 기반 별칭 이메일 사용 (예: xxx@simplelogin.com)

### 셀프인증 시스템 (email-verify.xyz)
- 로그인 시 "이메일 인증 코드" 필요 → 파티원이 직접 확인 가능
- 전달 메모에 안내된 URL: https://email-verify.xyz/email/mail/{ID}
- 해당 사이트에서 핀번호 입력 후 인증 코드 확인 가능
- 핀번호도 전달 메모에 적혀있음

### 프로필 규칙
- 프로필 이름: 본명에서 가운데 글자를 별(*)로 가림 (예: 홍*동)
- 특수기호 불가 시 본명 그대로 사용
- 기본 프로필이 1개만 있거나, 자리가 꽉 찼는데 기본 프로필이 있다면 → 그걸 수정해서 사용
- 다른 사람 프로필 절대 사용/삭제 금지

## 고객이 자주 하는 질문 & 모범 답변

### 1. "로그인이 안 돼요" / "비밀번호가 틀려요"
→ "전달 메모에 안내된 비밀번호를 다시 한번 확인해 주세요! 복사-붙여넣기 시 앞뒤 공백이 포함되지 않았는지 체크해 주세요 😊"
→ 비밀번호를 직접 알려주지 말 것!

### 2. "이메일 인증 코드가 왔어요" / "인증 코드 좀 알려주세요"
→ "전달 메모에 안내된 셀프인증 사이트에서 직접 확인 가능합니다! 😊
사이트 주소와 핀번호는 전달 메모에 있어요. 사이트에 접속하시면 인증 코드를 바로 확인하실 수 있습니다!"

### 3. "프로필을 어떻게 만들어요?" / "프로필 설정"
→ "프로필 추가 후, 이름을 본명에서 가운데 글자를 별(*)로 가려서 설정해 주세요! 예) 홍*동
혹시 기본 프로필만 있다면 그걸 수정해서 사용하시면 됩니다 😊"

### 4. "자리가 꽉 찼어요" / "프로필을 추가할 수 없어요"
→ "혹시 기본 프로필(프로필1 등)이 보이시나요? 있다면 그 프로필을 수정해서 사용하시면 됩니다!
그래도 안 되시면 말씀해 주세요, 확인해 드릴게요 😊"

### 5. "다른 사람이 내 프로필을 써요" / "프로필이 바뀌었어요"
→ "확인해 보겠습니다! 혹시 어떤 프로필을 사용하고 계셨는지 알려주시면 빠르게 처리해 드릴게요 😊"

### 6. "연장하고 싶어요" / "기간 연장"
→ "연장을 원하시면 현재 이용 종료 전에 말씀해 주시면 됩니다! 그레이택에서 연장 결제 후 자동으로 이어서 이용 가능합니다 😊"

### 7. "해지하고 싶어요" / "중도 종료"
→ "그레이택 사이트에서 직접 중도 해지 신청이 가능합니다. 잔여 기간에 대해 환불이 진행됩니다!
그레이택 고객센터(1:1 문의)로 문의하시면 더 자세한 안내를 받으실 수 있어요 😊"

### 8. "계정 정보를 다시 알려주세요" / "메모를 못 찾겠어요"
→ "그레이택 사이트 → 내 이용내역에서 전달 메모를 다시 확인하실 수 있습니다!
로그인 후 [마이페이지 → 이용 중인 파티]에서 확인해 보세요 😊"

### 9. "TV에서 로그인하려는데 안 돼요" / "기기 추가"
→ "TV에서 로그인 시에도 동일하게 이메일과 비밀번호를 입력하시면 됩니다!
이메일 인증 코드가 필요하면 전달 메모의 셀프인증 사이트에서 확인해 주세요 😊"

### 10. "화질이 안 좋아요" / "SD로만 나와요"
→ "화질 설정은 각 OTT 앱의 설정에서 변경 가능합니다!
혹시 계정 요금제 문제라면 확인해 보겠습니다 😊"

### 11. "언제부터 이용 가능해요?" / "전달이 안 됐어요"
→ "전달이 완료되면 그레이택에서 알림이 갑니다! 전달 메모에 계정 정보가 안내되어 있으니 확인해 주세요.
아직 전달이 안 됐다면 조금만 기다려 주세요 😊"

### 12. "감사합니다" / "고마워요" / 인사
→ "즐거운 시청 되세요! 문의 사항 있으시면 언제든 편하게 말씀해 주세요 😊"

### 13. "넵" / "네" / "확인했습니다" / 단순 확인
→ "감사합니다! 즐거운 시청 되세요 😊"

## 응답 원칙
1. 한국어로 답변
2. 파티장 입장에서 파티원에게 보내는 메시지 톤 (친절하고 간결)
3. 이모지 적절히 사용
4. 절대 비밀번호를 직접 알려주지 않음 → "전달 메모를 확인해 주세요"
5. 셀프인증 관련 → email-verify.xyz 사이트 안내 (전달 메모에 URL+핀번호 있음)
6. 모르는 질문 → "그레이택 고객센터(1:1 문의)로 문의해 주세요"
7. 짧고 핵심만 (2~4줄 이내)
8. 파티원이 화났을 때 → 먼저 사과하고 해결책 제시`;

app.post('/chat/ai-reply', async (c) => {
  const { messages, productType } = await c.req.json() as any;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'messages 배열이 필요합니다' }, 400);
  }

  try {
    // 최근 메시지 10개만 사용
    const recentMsgs = messages.slice(-10).map((m: any) => ({
      role: m.isOwned ? 'assistant' : 'user',
      content: m.message || '',
    }));

    const systemMsg = SYSTEM_PROMPT;

    // 빈 응답 방지: 최대 2회 재시도
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemMsg },
            ...recentMsgs,
          ],
          max_tokens: 800,
        }),
      });

      const data = await resp.json() as any;
      if (!resp.ok) {
        return c.json({ error: data.error?.message || 'OpenAI API 오류' }, 500);
      }

      const reply = (data.choices?.[0]?.message?.content || '').trim();
      if (reply) {
        return c.json({ reply, model: data.model, usage: data.usage });
      }
      // 빈 응답 → 재시도 (짧은 딜레이)
      console.log(`[AI-Reply] 빈 응답 (attempt ${attempt + 1}/3), 재시도...`);
      await new Promise(r => setTimeout(r, 1000));
    }

    return c.json({ reply: '', error: '3회 시도 후에도 빈 응답' }, 200);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── PicoClaw 자동 응답 로그 조회 ──────────────────────────────
// 로그는 server.ts의 autoReplyLog에 있지만, 여기서는 /tmp/picoclaw.log 파일로 조회
app.get('/chat/auto-reply-log', async (c) => {
  try {
    const { readFileSync, existsSync } = await import('fs');
    const logPath = '/home/ubuntu/graytag-session/auto-reply-rest-api.log';
    if (!existsSync(logPath)) return c.json({ logs: [], message: '아직 로그 없음' });
    const content = readFileSync(logPath, 'utf-8');
    const logs = content.trim().split('\n').filter(Boolean).slice(-50);
    return c.json({ logs, count: logs.length });
  } catch (e: any) { return c.json({ logs: [], error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO UNDERCUTTER: 실시간 가격 자동 인하 시스템
// ─────────────────────────────────────────────────────────────────────────────

const MY_LENDER_NAME = '노성민';

// 대상 카테고리 (마지노선 포함)
const UNDERCUTTER_CATEGORIES = [
  { key: 'netflix',  label: '넷플릭스',    query: '넷플릭스',    floor: 180 },
  { key: 'tving',    label: '티빙',        query: '티빙',        floor: 180 },
  { key: 'wavve',    label: '웨이브',      query: '웨이브',      floor: 110 },
  { key: 'disney',   label: '디즈니플러스', query: '디즈니플러스', floor: 110 },
];

const UNDERCUTTER_LOG_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/undercutter-log.json';

function loadUndercutterLog(): any[] {
  try {
    if (!existsSync(UNDERCUTTER_LOG_PATH)) return [];
    return JSON.parse(readFileSync(UNDERCUTTER_LOG_PATH, 'utf8'));
  } catch { return []; }
}

function saveUndercutterLog(logs: any[]) {
  try {
    const dir = UNDERCUTTER_LOG_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const trimmed = logs.slice(-200);
    writeFileSync(UNDERCUTTER_LOG_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch {}
}

let _undercutterRunning = false;

interface UndercutResult {
  category: string;
  action: 'updated' | 'skip' | 'error' | 'at_floor' | 'blocked';
  reason: string;
  myDaily?: number;
  rivalDaily?: number;
  targetDaily?: number;
  rivalName?: string;
  updatedCount?: number;
  floor?: number;
  productUsid?: string;
  blockedReasons?: string[];
}

async function runAutoUndercutter(dryRun = false): Promise<{ results: UndercutResult[]; timestamp: string; dryRun: boolean }> {
  if (_undercutterRunning) {
    return { results: [{ category: 'all', action: 'skip', reason: '이미 실행 중' }], timestamp: new Date().toISOString(), dryRun };
  }
  _undercutterRunning = true;

  const cookies = loadSessionCookies();
  const results: UndercutResult[] = [];

  try {
    for (const cat of UNDERCUTTER_CATEGORIES) {
      try {
        // 1) 해당 카테고리 전체 게시물 조회 (가격 오름차순)
        const url = `https://graytag.co.kr/ws/product/findProducts?productAvailable=OnSale&sorting=PricePerDay&productCategory=${encodeURIComponent(cat.query)}&page=1&rows=50`;
        const resp = await rateLimitedFetch(url, { headers: { ...BASE_HEADERS, Referer: 'https://graytag.co.kr/home' } });
        const r = await safeJson(resp);
        if (!r.ok || !r.data?.succeeded) {
          results.push({ category: cat.label, action: 'error', reason: 'API 조회 실패' });
          continue;
        }

        const allProducts: any[] = r.data.data?.products || [];
        if (allProducts.length === 0) {
          results.push({ category: cat.label, action: 'skip', reason: '게시물 없음' });
          continue;
        }

        // 2) 내 게시물 vs 경쟁자 분리
        const myProducts = allProducts.filter((p: any) => p.lenderName === MY_LENDER_NAME);
        const rivalProducts = allProducts.filter((p: any) => p.lenderName !== MY_LENDER_NAME);

        if (myProducts.length === 0) {
          results.push({ category: cat.label, action: 'skip', reason: '내 게시물 없음' });
          continue;
        }

        // 3) 내 최저 일당가
        const myLowestDaily = Math.min(...myProducts.map((p: any) =>
          parseInt((p.pricePerDay || '0').replace(/[^0-9]/g, '') || '0')
        ));

        // 4) 마지노선 초과인 경쟁자 vs 마지노선 이하 경쟁자
        const rivalAboveFloor = rivalProducts.filter((p: any) => {
          const daily = parseInt((p.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          return daily > cat.floor;
        }).sort((a, b) => {
          const aDaily = parseInt((a.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          const bDaily = parseInt((b.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          return aDaily - bDaily; // 오름차순: 싼 것부터 (1위)
        });

        const rivalBelowFloor = rivalProducts.filter((p: any) => {
          const daily = parseInt((p.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          return daily > 0 && daily <= cat.floor;
        }).sort((a, b) => {
          const aDaily = parseInt((a.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          const bDaily = parseInt((b.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          return bDaily - aDaily; // 내림차순: 비싼 것부터 (최대 threat)
        });

        // 5) 목표 일당가 결정
        let targetDaily: number;
        let rivalName: string = '';
        let rivalDaily: number = 0;

        if (rivalBelowFloor.length > 0) {
          // 마지노선 이하 경쟁자 존재
          // → floor 이하 경쟁자 정보는 기록용
          const belowRival = rivalBelowFloor[0];
          const belowRivalDaily = parseInt((belowRival.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');

          if (rivalAboveFloor.length > 0) {
            // floor 초과 경쟁자도 있으면 → 그 중 1위(최저가) 바로 밑으로 목표 설정
            const rival = rivalAboveFloor[0];
            rivalDaily = parseInt((rival.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
            rivalName = rival.lenderName;
            targetDaily = Math.max(rivalDaily - 1, cat.floor);
          } else {
            // floor 초과 경쟁자 없음 → 마지노선 고정
            rivalDaily = belowRivalDaily;
            rivalName = belowRival.lenderName;
            targetDaily = cat.floor;

            if (myLowestDaily === cat.floor) {
              results.push({ category: cat.label, action: 'at_floor', reason: `마지노선 고정 (경쟁자 ${rivalName}: ${rivalDaily}원 이하)`, myDaily: myLowestDaily, floor: cat.floor });
              continue;
            }
          }
        } else if (rivalAboveFloor.length === 0) {
          results.push({ category: cat.label, action: 'skip', reason: '마지노선 초과 경쟁자 없음', myDaily: myLowestDaily, floor: cat.floor });
          continue;
        } else {
          // 마지노선 초과 경쟁자 중 1위 가격 - 1원 = 목표 (공동 1위 포함)
          const rival = rivalAboveFloor[0];
          rivalDaily = parseInt((rival.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          rivalName = rival.lenderName;
          // 1위 목표: 1위 경쟁자보다 1원 낮게 (마지노선 하한)
          targetDaily = Math.max(rivalDaily - 1, cat.floor);
        }

        // 6) 이미 목표와 같으면 skip, 낮으면 올리기 위해 통과
        if (myLowestDaily === targetDaily) {
          results.push({
            category: cat.label, action: 'skip',
            reason: `이미 목표가 (내 ${myLowestDaily}원 = 목표 ${targetDaily}원)`,
            myDaily: myLowestDaily, rivalDaily, rivalName, targetDaily, floor: cat.floor,
          });
          continue;
        }

        // 7) dryRun이면 미리보기만
        if (dryRun) {
          results.push({
            category: cat.label, action: 'updated',
            reason: `[미리보기] ${myLowestDaily}원 → ${targetDaily}원/일 (경쟁자: ${rivalName} ${rivalDaily}원)`,
            myDaily: myLowestDaily, rivalDaily, rivalName, targetDaily, floor: cat.floor, updatedCount: myProducts.length,
          });
          continue;
        }

        if (!cookies) {
          results.push({ category: cat.label, action: 'error', reason: '세션 쿠키 없음' });
          continue;
        }

        const cookieStr = buildCookieStr(cookies);
        let updatedCount = 0;

        for (const myProduct of myProducts) {
          const myPpd = parseInt((myProduct.pricePerDay || '0').replace(/[^0-9]/g, '') || '0');
          const remainDays = myProduct.remainderDays || 0;
          if (remainDays <= 0) continue;
          if (myPpd === targetDaily) continue; // 같으면 skip, 낮으면 올림

          const newTotalPrice = targetDaily * remainDays;
          if (newTotalPrice < 1000) continue;

          const currentTotalPrice = Number(String(myProduct.purePrice ?? myProduct.price ?? (myPpd * remainDays)).replace(/[^0-9]/g, '') || '0');
          const safety = assertPriceChangeAllowed({
            productId: myProduct.usid,
            title: myProduct.title ?? myProduct.name,
            currentPrice: currentTotalPrice,
            nextPrice: newTotalPrice,
          });
          if (!safety.allowed) {
            results.push({
              category: cat.label,
              action: 'blocked',
              reason: `가격 안전장치 차단: ${safety.blockedReasons.join(', ')}`,
              myDaily: myPpd,
              targetDaily,
              floor: cat.floor,
              productUsid: myProduct.usid,
              blockedReasons: safety.blockedReasons,
            });
            continue;
          }

          try {
            const existing = await fetchProductSettings(cookieStr, myProduct.usid);
            const payload: any = {
              usid: myProduct.usid,
              name: existing?.name || '',
              copy: existing?.copy || '',
              sellingGuide: existing?.sellingGuide || '',
              endDate: existing?.endDateTime || '',
              netflixSeatCount: existing?.netflixSeatCount || '0',
              productCountryString: existing?.productCountryString || '',
              price: String(newTotalPrice),
            };

            const updateResp = await rateLimitedFetch('https://graytag.co.kr/ws/lender/updateProductInfo', {
              method: 'POST',
              headers: {
                ...BASE_HEADERS,
                Cookie: cookieStr,
                'Content-Type': 'application/json;charset=UTF-8',
                Referer: `https://graytag.co.kr/lender/product/setting?productUsid=${myProduct.usid}`,
              },
              body: JSON.stringify(payload),
              redirect: 'manual',
            });

            const ur = await safeJson(updateResp);
            if (ur.ok && ur.data?.succeeded) {
              recordSuccessfulPriceDecrease({
                productId: myProduct.usid,
                title: myProduct.title ?? myProduct.name,
                currentPrice: currentTotalPrice,
                nextPrice: newTotalPrice,
              });
              updatedCount++;
            }
          } catch {}

          await new Promise(res => setTimeout(res, 500));
        }

        results.push({
          category: cat.label, action: 'updated',
          reason: `${myLowestDaily}원 → ${targetDaily}원/일 (경쟁자: ${rivalName} ${rivalDaily}원)`,
          myDaily: myLowestDaily, rivalDaily, rivalName, targetDaily, floor: cat.floor, updatedCount,
        });

      } catch (e: any) {
        results.push({ category: cat.label, action: 'error', reason: e.message });
      }

      await new Promise(res => setTimeout(res, 400));
    }
  } finally {
    _undercutterRunning = false;
  }

  const entry = { timestamp: new Date().toISOString(), results, dryRun };

  if (!dryRun) {
    const logs = loadUndercutterLog();
    logs.push(entry);
    saveUndercutterLog(logs);
  }

  return entry;
}

// ─── Auto Undercutter API 라우트 ─────────────────────────────

// 미리보기 (실제 가격 변경 없음)
app.get('/auto-undercutter/preview', async (c) => {
  try {
    const result = await runAutoUndercutter(true);
    return c.json(result);
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// 실제 실행
app.post('/auto-undercutter/run', async (c) => {
  const requestId = auditRequestId(c);
  try {
    const result = await runAutoUndercutter(false);
    writeAudit({ actor: 'admin', action: 'auto-undercutter.run', targetType: 'price', targetId: 'auto-undercutter', summary: `auto-undercutter run: ${result.results.length} category results`, result: auditResultFromResults(result.results), requestId, details: result });
    return c.json(result);
  } catch (e: any) {
    writeAudit({ actor: 'admin', action: 'auto-undercutter.run', targetType: 'price', targetId: 'auto-undercutter', summary: 'auto-undercutter run failed', result: 'error', requestId, details: { error: e?.message } });
    return c.json({ error: e.message }, 500);
  }
});

// 실행 로그 조회
app.get('/auto-undercutter/log', (c) => {
  return c.json(loadUndercutterLog().slice(-50).reverse());
});

// ─── 수동 파티원 관리 (Manual Members) ──────────────────────────
const MANUAL_MEMBERS_PATH = "/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/manual-members.json";

interface ManualMember {
  id: string;
  serviceType: string;
  accountEmail: string;
  memberName: string;
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  price: number;
  source: string;         // 유입 출처 (당근, 에브리타임, 지인, 기타 등)
  memo: string;
  createdAt: string;
  status: "active" | "expired" | "cancelled";
}

function loadManualMembers(): ManualMember[] {
  try {
    if (!existsSync(MANUAL_MEMBERS_PATH)) return [];
    return JSON.parse(readFileSync(MANUAL_MEMBERS_PATH, "utf8"));
  } catch { return []; }
}

function saveManualMembers(members: ManualMember[]) {
  const dir = MANUAL_MEMBERS_PATH.replace(/\/[^\/]+$/, "");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(MANUAL_MEMBERS_PATH, JSON.stringify(members, null, 2), "utf8");
}

// 전체 조회
app.get("/manual-members", (c) => {
  const members = loadManualMembers();
  // 만료 자동 처리
  const now = new Date().toISOString().split("T")[0];
  let changed = false;
  for (const m of members) {
    if (m.status === "active" && m.endDate < now) {
      m.status = "expired";
      changed = true;
    }
  }
  if (changed) saveManualMembers(members);
  return c.json({ members, total: members.length });
});

// 추가
app.post("/manual-members", async (c) => {
  const body = await c.req.json() as any;
  const { serviceType, accountEmail, memberName, startDate, endDate, price, source, memo } = body;
  if (!serviceType || !memberName || !startDate || !endDate || !price) {
    return c.json({ error: "필수 항목: serviceType, memberName, startDate, endDate, price" }, 400);
  }

  const members = loadManualMembers();
  const newMember: ManualMember = {
    id: `mm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    serviceType,
    accountEmail: accountEmail || "",
    memberName,
    startDate,
    endDate,
    price: Number(price),
    source: source || "",
    memo: memo || "",
    createdAt: new Date().toISOString(),
    status: "active",
  };
  members.push(newMember);
  saveManualMembers(members);
  return c.json({ ok: true, member: newMember });
});

// 수정
app.put("/manual-members/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json() as any;
  const members = loadManualMembers();
  const idx = members.findIndex((m) => m.id === id);
  if (idx === -1) return c.json({ error: "멤버를 찾을 수 없습니다" }, 404);

  const m = members[idx];
  if (body.memberName !== undefined) m.memberName = body.memberName;
  if (body.startDate !== undefined) m.startDate = body.startDate;
  if (body.endDate !== undefined) m.endDate = body.endDate;
  if (body.price !== undefined) m.price = Number(body.price);
  if (body.source !== undefined) m.source = body.source;
  if (body.memo !== undefined) m.memo = body.memo;
  if (body.status !== undefined) m.status = body.status;
  if (body.accountEmail !== undefined) m.accountEmail = body.accountEmail;
  if (body.serviceType !== undefined) m.serviceType = body.serviceType;

  members[idx] = m;
  saveManualMembers(members);
  return c.json({ ok: true, member: m });
});

// 삭제
app.delete("/manual-members/:id", (c) => {
  const { id } = c.req.param();
  let members = loadManualMembers();
  const before = members.length;
  members = members.filter((m) => m.id !== id);
  if (members.length === before) return c.json({ error: "멤버를 찾을 수 없습니다" }, 404);
  saveManualMembers(members);
  return c.json({ ok: true });
});


// ─── 서버 사이드 Undercutter 상태 관리 ──────────────────────
const UNDERCUTTER_STATE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/undercutter-state.json';

interface UndercutterState {
  on: boolean;
  intervalMinutes: number;
  lastRun: string | null;
}

function loadUndercutterState(): UndercutterState {
  try {
    if (!existsSync(UNDERCUTTER_STATE_PATH)) return { on: false, intervalMinutes: 5, lastRun: null };
    return JSON.parse(readFileSync(UNDERCUTTER_STATE_PATH, 'utf8'));
  } catch { return { on: false, intervalMinutes: 5, lastRun: null }; }
}

function saveUndercutterState(state: UndercutterState) {
  const dir = UNDERCUTTER_STATE_PATH.replace(/\/[^\/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(UNDERCUTTER_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// GET: 현재 상태 조회
app.get('/auto-undercutter/state', (c) => {
  return c.json(loadUndercutterState());
});

// POST: ON/OFF + interval 변경
app.post('/auto-undercutter/state', async (c) => {
  const body = await c.req.json() as Partial<UndercutterState>;
  const current = loadUndercutterState();
  const newState: UndercutterState = {
    on: body.on !== undefined ? body.on : current.on,
    intervalMinutes: body.intervalMinutes !== undefined ? body.intervalMinutes : current.intervalMinutes,
    lastRun: current.lastRun,
  };
  saveUndercutterState(newState);
  // 전역 스케줄러 재시작 신호 (process event)
  process.emit('undercutter-state-changed' as any, newState);
  return c.json({ ok: true, state: newState });
});

// 채팅 읽음 표시
app.post('/chat/mark-read', async (c) => {
  const { chatRoomUuid } = await c.req.json() as { chatRoomUuid: string };
  const cookies = loadSessionCookies();
  if (!cookies) return c.json({ error: 'Session keeper 쿠키 없음' }, 400);

  try {
    const cookieStr = buildCookieStr(cookies);
    const resp = await fetch('https://graytag.co.kr/ws/chat/markRead', {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        Cookie: cookieStr,
        'Content-Type': 'application/json',
        Referer: 'https://graytag.co.kr/lender/deal/listAfterUsing',
      },
      body: JSON.stringify({ chatRoomUuid }),
    });

    if (resp.ok) {
      const data = await safeJson(resp);
      return c.json({ ok: true, ...data });
    } else {
      return c.json({ ok: false, error: `HTTP ${resp.status}` }, 500);
    }
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// ─── 파티 피드백 시스템 ──────────────────────────────────────────

const PARTY_FEEDBACK_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/party-feedback.json';
const FEEDBACK_SETTINGS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/feedback-settings.json';

interface FeedbackItem {
  id: string;
  type: 'extra_payment' | 'gap' | 'underfill_risk' | 'party_needed';
  serviceType: string;
  accountEmail: string;
  title: string;
  detail: string;
  generatedAt: string;
  done: boolean;
  doneAt: string | null;
}

interface FeedbackSettings {
  underfillWarningDays: number;
}

function loadFeedbackItems(): FeedbackItem[] {
  try {
    if (!existsSync(PARTY_FEEDBACK_PATH)) return [];
    return JSON.parse(readFileSync(PARTY_FEEDBACK_PATH, 'utf8'));
  } catch { return []; }
}

function saveFeedbackItems(items: FeedbackItem[]) {
  const dir = PARTY_FEEDBACK_PATH.replace(/\/[^\/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PARTY_FEEDBACK_PATH, JSON.stringify(items, null, 2), 'utf8');
}

function loadFeedbackSettings(): FeedbackSettings {
  try {
    if (!existsSync(FEEDBACK_SETTINGS_PATH)) return { underfillWarningDays: 0 };
    return JSON.parse(readFileSync(FEEDBACK_SETTINGS_PATH, 'utf8'));
  } catch { return { underfillWarningDays: 0 }; }
}

function saveFeedbackSettings(s: FeedbackSettings) {
  const dir = FEEDBACK_SETTINGS_PATH.replace(/\/[^\/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(FEEDBACK_SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
}

const FB_PARTY_MAX: Record<string, number> = {
  '\ub137\ud50c\ub9ad\uc2a4': 5, '\ub514\uc988\ub2c8\ud50c\ub7ec\uc2a4': 6, '\uc65b\ucc90\ud50c\ub808\uc774': 4, '\ud2f0\ube59': 4, '\uc6e8\uc774\ube0c': 4,
};
const fbGetPartyMax = (svc: string) => FB_PARTY_MAX[svc] || 6;
const FB_USING_STATUSES = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);

function generateFeedbackFromData(manageData: any, settings: FeedbackSettings): FeedbackItem[] {
  const items: FeedbackItem[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const parseDate = (s: string | null): Date | null => {
    if (!s) return null;
    // YY. MM. DD 또는 YYYY. MM. DD 형식 처리 (그레이태그 날짜)
    const parts = s.trim().split('.').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      let year = parseInt(parts[0]);
      if (year < 100) year += 2000;
      const month = parseInt(parts[1]);
      const day = parseInt(parts[2]);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        const d = new Date(year, month - 1, day);
        d.setHours(0, 0, 0, 0);
        return d;
      }
    }
    // ISO 형식 폴백
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
  const dayStr = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  for (const svc of (manageData.services || [])) {
    for (const acct of (svc.accounts || [])) {
      if (acct.usingCount === 0) continue;

      const usingMembers = (acct.members || []).filter((m: any) => FB_USING_STATUSES.has(m.status));
      const expiryDate = parseDate(acct.expiryDate);
      const partyMax = fbGetPartyMax(svc.serviceType);
      const emailShort = acct.email.split('@')[0].slice(0, 10);

      // Case A: endDate > expiryDate
      if (expiryDate) {
        for (const m of usingMembers) {
          const mEnd = parseDate(m.endDateTime);
          if (!mEnd) continue;
          const over = diffDays(expiryDate, mEnd);
          if (over > 0) {
            const name = m.name || '\ud30c\ud2f0\uc6d0';
            items.push({
              id: `extra_a_${acct.email}_${svc.serviceType}_${m.dealUsid}`,
              type: 'extra_payment',
              serviceType: svc.serviceType,
              accountEmail: acct.email,
              title: `[${svc.serviceType}] ${emailShort} \u2014 \uacb0\uc81c \ucd08\uacfc \uc774\uc6a9`,
              detail: `\ud30c\ud2f0\uc6d0 "${name}"\uc774 \uacc4\uc815 \ub9cc\ub8cc\uc77c(${dayStr(expiryDate)})\ubcf4\ub2e4 ${over}\uc77c \ub354 \uc774\uc6a9 \uc608\uc815\uc785\ub2c8\ub2e4. \ud55c \uba85\uc744 \uc704\ud55c \ucd94\uac00 1\ub2ec\uce58 \uacb0\uc81c\uac00 \ubc1c\uc0dd\ud560 \uc218 \uc788\uc5b4\uc694.`,
              generatedAt: new Date().toISOString(),
              done: false,
              doneAt: null,
            });
          }
        }
      }

      // Case B: 파티원 간 종료일 편차 7일+
      const endDates = usingMembers
        .map((m: any) => parseDate(m.endDateTime))
        .filter((d: Date | null): d is Date => d !== null);

      if (endDates.length >= 2) {
        const minEnd = endDates.reduce((a: Date, b: Date) => a < b ? a : b);
        const maxEnd = endDates.reduce((a: Date, b: Date) => a > b ? a : b);
        const gap = diffDays(minEnd, maxEnd);
        if (gap >= 7) {
          items.push({
            id: `extra_b_${acct.email}_${svc.serviceType}`,
            type: 'extra_payment',
            serviceType: svc.serviceType,
            accountEmail: acct.email,
            title: `[${svc.serviceType}] ${emailShort} \u2014 \uc885\ub8cc\uc77c \ud3b8\ucc28 \uacbd\uace0`,
            detail: `\ud30c\ud2f0\uc6d0\ub4e4\uc758 \uc774\uc6a9 \uc885\ub8cc\uc77c\uc774 \ucd5c\ub300 ${gap}\uc77c \ucc28\uc774(${dayStr(minEnd)}~${dayStr(maxEnd)})\ub098\uc694. \ub2a6\uac8c \ub04a\ub098\ub294 \ud30c\ud2f0\uc6d0\uc744 \uc704\ud574 1\ub2ec\uce58 \ucd94\uac00 \uacb0\uc81c\uac00 \ubc1c\uc0dd\ud560 \uc218 \uc788\uc5b4\uc694.`,
            generatedAt: new Date().toISOString(),
            done: false,
            doneAt: null,
          });
        }
      }

      // Gap: 파티 공백
      if (expiryDate) {
        for (const m of usingMembers) {
          const mEnd = parseDate(m.endDateTime);
          if (!mEnd) continue;
          const gapDays = diffDays(mEnd, expiryDate);
          if (gapDays >= 3 && mEnd > today) {
            const name = m.name || '\ud30c\ud2f0\uc6d0';
            items.push({
              id: `gap_${acct.email}_${svc.serviceType}_${m.dealUsid}`,
              type: 'gap',
              serviceType: svc.serviceType,
              accountEmail: acct.email,
              title: `[${svc.serviceType}] ${emailShort} \u2014 \ud30c\ud2f0 \uacf5\ubc31 \uc608\uc0c1`,
              detail: `"${name}" ${dayStr(mEnd)} \uc885\ub8cc \ud6c4 \ub9cc\ub8cc\uc77c(${dayStr(expiryDate)})\uae4c\uc9c0 ${gapDays}\uc77c\ub3d9\uc548 \uc2ac\ub86f 1\uac1c\uac00 \ube44\uc5b4\uc694.`,
              generatedAt: new Date().toISOString(),
              done: false,
              doneAt: null,
            });
          }
        }
      }

      // Underfill risk
      if (expiryDate) {
        const daysToExpiry = diffDays(today, expiryDate);
        const vacancy = partyMax - acct.usingCount;
        if (vacancy > 0 && daysToExpiry >= 0 && daysToExpiry <= settings.underfillWarningDays) {
          items.push({
            id: `underfill_${acct.email}_${svc.serviceType}`,
            type: 'underfill_risk',
            serviceType: svc.serviceType,
            accountEmail: acct.email,
            title: `[${svc.serviceType}] ${emailShort} \u2014 \ubbf8\ucc44\uc6c0 \uacb0\uc81c \uc784\ubc15`,
            detail: `${acct.usingCount}/${partyMax}\uba85 \uc548 \ucc44\uc6cc\uc9c4 \uc0c1\ud0dc\uc5d0\uc11c ${daysToExpiry}\uc77c \ud6c4(${dayStr(expiryDate)}) \ub2e4\uc74c \ub2ec \uacb0\uc81c \uc608\uc815\uc785\ub2c8\ub2e4. \ube48\uc790\ub9ac ${vacancy}\uac1c\ub97c \ucc44\uc6cc\ubcf4\uc138\uc694.`,
            generatedAt: new Date().toISOString(),
            done: false,
            doneAt: null,
          });
        }
      }
    }
  }


  // party_needed: 핵심 서비스 중 OnSale 파티가 없는 서비스 감지
  // onSaleByKeepAcct key = keepAcct(이메일), services[].accounts[].email 과 비교
  const CORE_SERVICES = ['넷플릭스', '디즈니플러스', '티빙', '웨이브'];
  const FB_PARTY_MAX: Record<string, number> = {
    '넷플릭스': 5, '디즈니플러스': 6, '티빙': 4, '웨이브': 4,
  };
  const onSaleEmails = new Set<string>(Object.keys(manageData.onSaleByKeepAcct || {}));

  for (const svc of CORE_SERVICES) {
    const svcGroup = (manageData.services || []).find((s: any) => s.serviceType === svc);
    const hasSelling = svcGroup
      ? (svcGroup.accounts || []).some((a: any) => onSaleEmails.has(a.email))
      : false;

    if (!hasSelling) {
      const hasAccounts = svcGroup && (svcGroup.accounts || []).length > 0;

      // 파티 fill ratio 계산: usingCount > 0 인 계정만 대상
      let avgFillRatio = 0;
      if (hasAccounts) {
        const accounts = (svcGroup.accounts || []).filter((a: any) => a.usingCount > 0);
        const partyMax = FB_PARTY_MAX[svc] || 6;
        const totalUsing = accounts.reduce((sum: number, a: any) => sum + (a.usingCount || 0), 0);
        const totalSlots = accounts.length * partyMax;
        avgFillRatio = totalSlots > 0 ? totalUsing / totalSlots : 0;
      }

      // 메시지 결정
      let detail: string;
      if (!hasAccounts) {
        detail = `${svc} 파티가 없습니다. 새 파티 계정을 생성해주세요.`;
      } else if (avgFillRatio >= 0.8) {
        // 80% 이상 찬 경우 = 거의 풀파티
        detail = `모든 ${svc} 파티가 풀로 차 있습니다. 새 계정 생성 후 파티 등록이 필요합니다.`;
      } else {
        // 빈자리가 있는 경우
        detail = `${svc} 계정은 있지만 현재 판매 등록된 파티가 없습니다. 그레이태그에 파티를 등록해주세요.`;
      }

      items.push({
        id: `party_needed_${svc}`,
        type: 'party_needed',
        serviceType: svc,
        accountEmail: '',
        title: `[${svc}] 파티 계정 필요`,
        detail,
        generatedAt: new Date().toISOString(),
        done: false,
        doneAt: null,
      });
    }
  }

  return items;
}

// GET: 피드백 목록
app.get('/party-feedback', (c) => {
  return c.json({ items: loadFeedbackItems() });
});

// POST: 피드백 재생성
app.post('/party-feedback/generate', async (c) => {
  const body = await c.req.json() as any;
  const manageData = body.manageData;
  if (!manageData) return c.json({ error: 'manageData required' }, 400);

  const settings = loadFeedbackSettings();
  const newItems = generateFeedbackFromData(manageData, settings);

  const existing = loadFeedbackItems();
  const doneMap = new Map(existing.filter(i => i.done).map(i => [i.id, i]));

  const merged = newItems.map(item => {
    const prev = doneMap.get(item.id);
    if (prev) return { ...item, done: true, doneAt: prev.doneAt };
    return item;
  });

  saveFeedbackItems(merged);
  return c.json({ items: merged, generated: newItems.length });
});

// POST: done 토글
app.post('/party-feedback/:id/toggle', (c) => {
  const { id } = c.req.param();
  const items = loadFeedbackItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return c.json({ error: '\ud56d\ubaa9\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc5b4\uc694' }, 404);
  items[idx].done = !items[idx].done;
  items[idx].doneAt = items[idx].done ? new Date().toISOString() : null;
  saveFeedbackItems(items);
  return c.json({ ok: true, item: items[idx] });
});

// GET: 설정 조회
app.get('/feedback-settings', (c) => {
  return c.json(loadFeedbackSettings());
});

// POST: 설정 저장
app.post('/feedback-settings', async (c) => {
  const body = await c.req.json() as any;
  const settings: FeedbackSettings = {
    underfillWarningDays: typeof body.underfillWarningDays === 'number' ? body.underfillWarningDays : 0,
  };
  saveFeedbackSettings(settings);
  return c.json({ ok: true, settings });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO REPLY CONFIG: 자동응답 설정 관리
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_REPLY_CONFIG_PATH = "/home/ubuntu/graytag-session/auto-reply-config.json";

interface AutoReplyConfig {
  enabled: boolean;
  systemPrompt: string;
  delaySeconds: number;
}

function loadAutoReplyConfig(): AutoReplyConfig {
  const defaults: AutoReplyConfig = { enabled: true, systemPrompt: "", delaySeconds: 0 };
  try {

    if (!existsSync(AUTO_REPLY_CONFIG_PATH)) return defaults;
    return { ...defaults, ...JSON.parse(readFileSync(AUTO_REPLY_CONFIG_PATH, "utf-8")) };
  } catch { return defaults; }
}

function saveAutoReplyConfig(cfg: AutoReplyConfig): void {

  writeFileSync(AUTO_REPLY_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// GET /chat/auto-reply/state
app.get("/chat/auto-reply/state", (c) => {
  const cfg = loadAutoReplyConfig();
  return c.json({ enabled: cfg.enabled, delaySeconds: cfg.delaySeconds });
});

// POST /chat/auto-reply/state
app.post("/chat/auto-reply/state", async (c) => {
  const body = await c.req.json() as any;
  const cfg = loadAutoReplyConfig();
  if (typeof body.enabled === "boolean") cfg.enabled = body.enabled;
  if (typeof body.delaySeconds === "number") cfg.delaySeconds = body.delaySeconds;
  saveAutoReplyConfig(cfg);
  return c.json({ ok: true, enabled: cfg.enabled, delaySeconds: cfg.delaySeconds });
});

// GET /chat/auto-reply/prompt
app.get("/chat/auto-reply/prompt", (c) => {
  const cfg = loadAutoReplyConfig();
  return c.json({ systemPrompt: cfg.systemPrompt });
});

// POST /chat/auto-reply/prompt
app.post("/chat/auto-reply/prompt", async (c) => {
  const body = await c.req.json() as any;
  if (typeof body.systemPrompt !== "string") return c.json({ error: "systemPrompt 필수" }, 400);
  const cfg = loadAutoReplyConfig();
  cfg.systemPrompt = body.systemPrompt;
  saveAutoReplyConfig(cfg);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTY NOTICE: 파티원 전체 공지 발송
// ─────────────────────────────────────────────────────────────────────────────

// POST /chat/notice/send
app.post("/chat/notice/send", async (c) => {
  const body = await c.req.json() as any;
  const { targetEmail, message, statusFilter } = body as {
    targetEmail: string;
    message: string;
    statusFilter?: string[];
  };

  if (!targetEmail) return c.json({ error: "targetEmail 필수" }, 400);
  if (!message || !message.trim()) return c.json({ error: "message 필수" }, 400);

  const allowedStatuses = new Set<string>(
    statusFilter && statusFilter.length > 0
      ? statusFilter
      : ["Using", "UsingNearExpiration", "DeliveredAndCheckPrepaid"]
  );

  try {
    const cookies = resolveCookies({});
    if (!cookies) return c.json({ error: "쿠키 없음 — session-keeper 확인 필요" }, 401);
    const cookieStr = buildCookieStr(cookies);
    const authedHeaders = (referer: string) => ({ ...BASE_HEADERS, Cookie: cookieStr, Referer: referer });

    // 1. chat/rooms 기반으로 발송 대상 직접 추출 (keepAcct+chatRoomUuid+status 있음)
    let rooms: any[] = [];
    if (_chatRoomsCache) {
      rooms = _chatRoomsCache.rooms;
    } else {
      const [lbR, laR] = await Promise.all([
        rateLimitedFetch("https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=500",
          { headers: authedHeaders("https://graytag.co.kr/lender/deal/list"), redirect: "manual" }),
        rateLimitedFetch("https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=500",
          { headers: authedHeaders("https://graytag.co.kr/lender/deal/listAfterUsing"), redirect: "manual" }),
      ]);
      const [lb, la] = await Promise.all([safeJson(lbR), safeJson(laR)]);
      const seen = new Set();
      for (const d of [...(lb.data?.data?.lenderDeals||[]),...(la.data?.data?.lenderDeals||[])]) {
        if (d.chatRoomUuid && !seen.has(d.dealUsid)) { seen.add(d.dealUsid); rooms.push(d); }
      }
    }

    const tEmail = targetEmail.trim().toLowerCase();
    const targetDeals = rooms.filter((r: any) =>
      (r.keepAcct||"").trim().toLowerCase()===tEmail && allowedStatuses.has(r.dealStatus) && r.chatRoomUuid
    );

    if (targetDeals.length === 0) {
      return c.json({ ok: true, sent: 0, failed: 0, skipped: 0, details: [], message: "대상 파티원 없음" });
    }

    // 3. 각 파티원에게 발송
    const details: Array<{ dealUsid: string; name: string | null; status: string; result: "sent" | "failed" | "skipped"; error?: string }> = [];
    let sent = 0, failed = 0, skipped = 0;

    for (const deal of targetDeals) {
      const chatRoomUuid = deal.chatRoomUuid;

      if (!chatRoomUuid) {
        details.push({ dealUsid: deal.dealUsid, name: deal.borrowerName || null, status: deal.dealStatus, result: "skipped", error: "chatRoomUuid 없음" });
        skipped++;
        continue;
      }

      try {
        const cleanMessage = message.replace(/\n/g, "<br>");
        const { execSync } = await import("child_process");
        const args = ["/home/ubuntu/graytag-session/stomp-sender.cjs", chatRoomUuid, cleanMessage];
        if (deal.dealUsid) args.push(deal.dealUsid);
        const cmd = "node " + args.map((a: string) => JSON.stringify(a)).join(" ");
        const result = JSON.parse(execSync(cmd, { timeout: 20000 }).toString().trim());

        if (result.ok) {
          details.push({ dealUsid: deal.dealUsid, name: deal.borrowerName || null, status: deal.dealStatus, result: "sent" });
          sent++;
        } else {
          details.push({ dealUsid: deal.dealUsid, name: deal.borrowerName || null, status: deal.dealStatus, result: "failed", error: result.error });
          failed++;
        }
      } catch (e: any) {
        details.push({ dealUsid: deal.dealUsid, name: deal.borrowerName || null, status: deal.dealStatus, result: "failed", error: e.message?.slice(0, 100) });
        failed++;
      }

      // rate-limit 방지: 300ms 간격
      await new Promise(res => setTimeout(res, 300));
    }

    return c.json({ ok: true, sent, failed, skipped, total: targetDeals.length, details });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});
