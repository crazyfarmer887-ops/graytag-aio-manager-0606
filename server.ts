import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import apiApp from './src/api/index.ts';
import {
  createDashboardSessionToken,
  dashboardAdminPassword,
  dashboardSessionCookie,
  isDashboardHtmlPath,
  verifyDashboardSessionCookie,
} from './src/lib/dashboard-session.ts';
import { scheduleAutoSync } from './src/scheduler/auto-sync.ts';
import { startUndercutterScheduler } from './src/scheduler/undercutter.ts';
import { startPollDaemon } from './src/scheduler/poll-daemon.ts';
import { startAutoReplyDaemon } from './src/scheduler/auto-reply-daemon.ts';
import { buildPartyAccessHtml } from './src/lib/party-access-page-html.ts';

const distDir = resolve(process.cwd(), 'dist/client');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const app = new Hono();

app.route('/api', apiApp);

function isHttpsRequest(c: any): boolean {
  const forwardedProto = String(c.req.header('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'https') return true;
  return new URL(c.req.url).protocol === 'https:';
}

function dashboardLoginHtml(error = ''): string {
  const errorHtml = error ? `<div class="error">${error}</div>` : '';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GrayTag 관리자 확인</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#f5f3ff,#eef2ff);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e1b4b}
    .card{width:min(92vw,390px);background:#fff;border:1px solid #ede9fe;border-radius:24px;padding:28px;box-shadow:0 24px 70px rgba(79,70,229,.18)}
    h1{font-size:22px;margin:0 0 8px;font-weight:900}.desc{font-size:13px;color:#6b7280;line-height:1.55;margin:0 0 20px}.label{font-size:12px;font-weight:800;margin-bottom:8px;display:block}
    input{width:100%;box-sizing:border-box;border:1.5px solid #ddd6fe;border-radius:14px;padding:13px 14px;font-size:16px;outline:none}input:focus{border-color:#7c3aed;box-shadow:0 0 0 4px #ede9fe}
    button{width:100%;border:0;border-radius:14px;background:#7c3aed;color:#fff;padding:13px 14px;font-size:15px;font-weight:900;margin-top:14px;cursor:pointer}.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:800;margin-bottom:14px}
    .hint{font-size:11px;color:#9ca3af;margin-top:14px;line-height:1.45}
  </style>
</head>
<body>
  <form class="card" method="post" action="/dashboard/login">
    <h1>관리자 비밀번호</h1>
    <p class="desc">/dashboard는 관리자만 볼 수 있어요. 한 번 인증하면 이 브라우저에서는 기존처럼 바로 열립니다.</p>
    ${errorHtml}
    <label class="label" for="password">비밀번호</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">대시보드 들어가기</button>
    <div class="hint">이메일 토큰 사이트에서 우연히 /dashboard로 들어오는 접근을 막기 위한 잠금 화면입니다.</div>
  </form>
</body>
</html>`;
}

app.post('/dashboard/login', async (c) => {
  const body = await c.req.text();
  const params = new URLSearchParams(body);
  const password = String(params.get('password') || '');
  const expected = dashboardAdminPassword();
  if (password !== expected) {
    return new Response(dashboardLoginHtml('비밀번호가 맞지 않아요.'), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const token = createDashboardSessionToken({ password: expected });
  return new Response(null, {
    status: 303,
    headers: {
      'location': '/dashboard',
      'set-cookie': dashboardSessionCookie(token, undefined, isHttpsRequest(c)),
      'cache-control': 'no-store',
    },
  });
});

function partyAccessHtmlResponse(token: string): Response {
  return new Response(buildPartyAccessHtml(token), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

app.get('/dashboard/access/:token', (c) => partyAccessHtmlResponse(c.req.param('token')));
app.get('/access/:token', (c) => partyAccessHtmlResponse(c.req.param('token')));

function normalizeDashboardAssetPath(pathname: string): string {
  return pathname.startsWith('/dashboard/assets/') ? pathname.replace(/^\/dashboard(?=\/assets\/)/, '') : pathname;
}

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const pathname = decodeURIComponent(url.pathname);
  if (isDashboardHtmlPath(pathname) && !verifyDashboardSessionCookie(c.req.header('cookie'), dashboardAdminPassword())) {
    return new Response(dashboardLoginHtml(), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const assetPathname = normalizeDashboardAssetPath(pathname);
  const candidatePath = assetPathname === '/' || assetPathname === '/dashboard' || assetPathname === '/dashboard/' ? '/index.html' : assetPathname;
  const filePath = resolve(distDir, `.${candidatePath}`);

  if (!filePath.startsWith(distDir)) return c.text('Forbidden', 403);

  if (existsSync(filePath)) {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      const content = await readFile(filePath);
      return new Response(content, {
        headers: {
          'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
          'cache-control': candidatePath === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      });
    }
  }

  const indexPath = resolve(distDir, 'index.html');
  if (existsSync(indexPath)) {
    const content = await readFile(indexPath);
    return new Response(content, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    });
  }

  return c.text('Build the client first with npm run build.', 503);
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port });
console.log(`GrayTag local server running at http://localhost:${port}`);

// 스케줄러 시작
scheduleAutoSync(port);
startUndercutterScheduler(port);
startPollDaemon();
startAutoReplyDaemon(port);
