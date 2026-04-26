import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import apiApp from './src/api/index.ts';
import { scheduleAutoSync } from './src/scheduler/auto-sync.ts';
import { startUndercutterScheduler } from './src/scheduler/undercutter.ts';
import { startPollDaemon } from './src/scheduler/poll-daemon.ts';

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

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const pathname = decodeURIComponent(url.pathname);
  const candidatePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(distDir, `.${candidatePath}`);

  if (!filePath.startsWith(distDir)) return c.text('Forbidden', 403);

  if (existsSync(filePath)) {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      const content = await readFile(filePath);
      return new Response(content, {
        headers: {
          'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
          'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
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
