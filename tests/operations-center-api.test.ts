import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import apiApp from '../src/api/index';

const token = 'operations-center-test-token';
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

describe('operations center API', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'operations-center-api-'));
    process.env.AIO_ADMIN_TOKEN = token;
    process.env.MANUAL_RESPONSE_QUEUE_PATH = join(tempDir, 'manual-response-queue.json');
    process.env.AUTO_REPLY_JOBS_PATH = join(tempDir, 'auto-reply-jobs.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.AIO_ADMIN_TOKEN;
    delete process.env.MANUAL_RESPONSE_QUEUE_PATH;
    delete process.env.AUTO_REPLY_JOBS_PATH;
  });

  test('requires admin auth for manual response queue', async () => {
    const res = await apiApp.request('/operations-center/manual-response-queue');
    expect(res.status).toBe(403);
  });

  test('creates and updates Kakao manual response queue items', async () => {
    const create = await authed('/operations-center/manual-response-queue', {
      method: 'POST',
      body: JSON.stringify({ source: '카카오톡', buyerName: '김고객', serviceType: '웨이브', message: '확인 부탁드려요' }),
    });
    expect(create.status).toBe(200);
    const created = await create.json() as any;
    expect(created.item.source).toBe('카카오톡');
    expect(created.summary.open).toBe(1);

    const update = await authed(`/operations-center/manual-response-queue/${created.item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done', memo: '답변 완료' }),
    });
    const updated = await update.json() as any;
    expect(updated.item.status).toBe('done');
    expect(updated.item.doneAt).toBeTruthy();
    expect(updated.summary.open).toBe(0);
  });

  test('returns operations center summary from manual queue and auto reply jobs', async () => {
    await authed('/operations-center/manual-response-queue', {
      method: 'POST',
      body: JSON.stringify({ source: '수동고객', buyerName: '이수동', message: '연장 문의', priority: 'high' }),
    });
    const res = await authed('/operations-center/summary');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
    expect(json.center.summary.replyQueueOpen).toBe(1);
    expect(json.center.recommendedActions[0].label).toMatch(/수동|카카오톡/);
  });
});
