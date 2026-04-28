import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import apiApp from '../src/api/index';

const token = 'test-admin-token';
let tempDir = '';

function authed(path: string, init: RequestInit = {}) {
  return apiApp.request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function candidate(unique: string, message = '로그인이 안돼요') {
  return {
    chatRoomUuid: unique,
    dealUsid: 'deal-1',
    buyerName: '민수',
    productType: '넷플릭스',
    productName: '넷플릭스 프리미엄',
    message,
    registeredDateTime: '2026-04-28T01:00:00Z',
  };
}

describe('auto reply API', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-reply-api-'));
    process.env.AIO_ADMIN_TOKEN = token;
    process.env.AUTO_REPLY_JOBS_PATH = join(tempDir, 'jobs.json');
    process.env.AUTO_REPLY_CONFIG_PATH = join(tempDir, 'config.json');
    process.env.AUTO_REPLY_ENABLED = 'true';
    process.env.AUTO_REPLY_DRAFT_ONLY = 'true';
    process.env.AUTO_REPLY_USE_HERMES = 'false';
    process.env.AUTO_REPLY_ENABLE_SEND = 'false';
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.AUTO_REPLY_JOBS_PATH;
    delete process.env.AUTO_REPLY_CONFIG_PATH;
    delete process.env.AUTO_REPLY_ENABLED;
    delete process.env.AUTO_REPLY_DRAFT_ONLY;
    delete process.env.AUTO_REPLY_USE_HERMES;
    delete process.env.AUTO_REPLY_ENABLE_SEND;
  });

  test('requires admin auth for auto-reply log', async () => {
    const res = await apiApp.request('/chat/auto-reply-log');
    expect(res.status).toBe(403);
  });

  test('tick with mock candidates queues and drafts without sending in draft-only mode', async () => {
    const unique = `api-room-${Date.now()}`;
    const res = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({
        dryRun: true,
        candidates: [candidate(unique)],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
    expect(json.newJobs).toBe(1);
    expect(json.drafted).toBe(1);
    expect(json.sent).toBe(0);
  });

  test('tick skips an already drafted fingerprint instead of reprocessing it', async () => {
    const unique = `api-dedupe-room-${Date.now()}`;
    const body = JSON.stringify({ dryRun: true, candidates: [candidate(unique)] });
    const first = await authed('/chat/auto-reply/tick', { method: 'POST', body });
    expect((await first.json() as any).drafted).toBe(1);

    const second = await authed('/chat/auto-reply/tick', { method: 'POST', body });
    const json = await second.json() as any;
    expect(json.newJobs).toBe(0);
    expect(json.drafted).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.sent).toBe(0);
  });

  test('auto-reply state drives tick policy and can disable drafting', async () => {
    await authed('/chat/auto-reply/state', {
      method: 'POST',
      body: JSON.stringify({ enabled: false, delaySeconds: 0 }),
    });

    const res = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: false, candidates: [candidate(`api-disabled-room-${Date.now()}`)] }),
    });
    const json = await res.json() as any;
    expect(json.drafted).toBe(1);

    const log = await authed('/chat/auto-reply-log?limit=1');
    const data = await log.json() as any;
    expect(data.jobs[0].blockReason).toBe('자동응답이 꺼져 있음');
  });

  test('manual AI reply endpoint uses Hermes path or safe fallback, not OpenAI/PicoClaw', async () => {
    const res = await authed('/chat/ai-reply', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ message: '로그인이 안돼요', isOwned: false }], productType: '넷플릭스' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.reply).toContain('확인');
    expect(json.model).toBe('hermes-disabled-safe-fallback');
  });
});
