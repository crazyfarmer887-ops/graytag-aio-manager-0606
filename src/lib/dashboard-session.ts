import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_DASHBOARD_ADMIN_PASSWORD = 'anteater87@';
export const DASHBOARD_SESSION_COOKIE = 'graytag_dashboard_session';
export const DASHBOARD_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface EnvLike {
  DASHBOARD_ADMIN_PASSWORD?: string;
  DASHBOARD_SESSION_SECRET?: string;
}

interface TokenOptions {
  password: string;
  now?: number;
  ttlMs?: number;
  secret?: string;
}

interface VerifyOptions {
  password: string;
  now?: number;
  secret?: string;
}

function sessionSecret(password: string, explicitSecret?: string): string {
  return (explicitSecret || process.env.DASHBOARD_SESSION_SECRET || password).trim();
}

function safeEqual(left: string, right: string): boolean {
  const l = Buffer.from(left, 'hex');
  const r = Buffer.from(right, 'hex');
  return l.length === r.length && timingSafeEqual(l, r);
}

export function dashboardAdminPassword(env: EnvLike = process.env): string {
  const configured = env.DASHBOARD_ADMIN_PASSWORD?.trim();
  return configured || DEFAULT_DASHBOARD_ADMIN_PASSWORD;
}

export function createDashboardSessionToken(options: TokenOptions): string {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DASHBOARD_SESSION_TTL_MS;
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  const sig = createHmac('sha256', sessionSecret(options.password, options.secret)).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyDashboardSessionToken(token: string | null | undefined, options: VerifyOptions): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', sessionSecret(options.password, options.secret)).update(payload).digest('hex');
  try {
    if (!safeEqual(sig, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    const exp = Number(claims.exp);
    const now = options.now ?? Date.now();
    return Number.isFinite(exp) && exp > now;
  } catch {
    return false;
  }
}

export function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); }
    catch { cookies[key] = value; }
  }
  return cookies;
}

export function verifyDashboardSessionCookie(cookieHeader: string | null | undefined, password = dashboardAdminPassword()): boolean {
  const cookies = parseCookieHeader(cookieHeader);
  return verifyDashboardSessionToken(cookies[DASHBOARD_SESSION_COOKIE], { password });
}

export function isDashboardHtmlPath(pathname: string): boolean {
  if (pathname === '/dashboard' || pathname === '/dashboard/') return true;
  if (!pathname.startsWith('/dashboard/')) return false;
  if (pathname.startsWith('/dashboard/assets/')) return false;
  const last = pathname.split('/').pop() || '';
  return !last.includes('.');
}

export function dashboardSessionCookie(token: string, maxAgeSeconds = Math.floor(DASHBOARD_SESSION_TTL_MS / 1000), secure = false): string {
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
