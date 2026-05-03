import { describe, expect, test } from 'vitest';
import {
  createDashboardSessionToken,
  dashboardAdminPassword,
  isDashboardHtmlPath,
  verifyDashboardSessionToken,
} from '../src/lib/dashboard-session';

describe('dashboard password session', () => {
  test('uses anteater87@ as the initial dashboard password when no override is set', () => {
    const env: Record<string, string | undefined> = {};
    expect(dashboardAdminPassword(env)).toBe('anteater87@');
  });

  test('signs dashboard cookies and rejects tampered or expired tokens', () => {
    const now = Date.parse('2026-05-03T00:00:00.000Z');
    const token = createDashboardSessionToken({ password: 'anteater87@', now, ttlMs: 60_000 });

    expect(verifyDashboardSessionToken(token, { password: 'anteater87@', now: now + 1000 })).toBe(true);
    expect(verifyDashboardSessionToken(token.replace(/.$/, '0'), { password: 'anteater87@', now: now + 1000 })).toBe(false);
    expect(verifyDashboardSessionToken(token, { password: 'anteater87@', now: now + 120_000 })).toBe(false);
  });

  test('requires the password gate for dashboard HTML routes but not assets or APIs', () => {
    expect(isDashboardHtmlPath('/dashboard')).toBe(true);
    expect(isDashboardHtmlPath('/dashboard/')).toBe(true);
    expect(isDashboardHtmlPath('/dashboard/manage')).toBe(true);
    expect(isDashboardHtmlPath('/dashboard/assets/index-abc123.js')).toBe(false);
    expect(isDashboardHtmlPath('/api/ping')).toBe(false);
  });
});
