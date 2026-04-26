import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSellerAlert } from './src/alerts/telegram.ts';

const originalToken = process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
const originalChat = process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;

let tmp: string | null = null;

afterEach(() => {
  if (originalToken === undefined) delete process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
  else process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = originalToken;
  if (originalChat === undefined) delete process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
  else process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = originalChat;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
  vi.restoreAllMocks();
});

function tempStatePath() {
  tmp = mkdtempSync(join(tmpdir(), 'seller-alert-'));
  return join(tmp, 'alert-state.json');
}

describe('seller Telegram alerts', () => {
  it('is quietly disabled when Telegram env is missing', async () => {
    delete process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
    delete process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
    const fetchMock = vi.fn();

    const result = await sendSellerAlert({
      key: 'poll-daemon-failure',
      title: 'PollDaemon 장애',
      body: '연속 실패 3회',
      statePath: tempStatePath(),
      fetchImpl: fetchMock as any,
      nowMs: 1_000,
    });

    expect(result).toEqual({ sent: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends once and throttles the same key for 30 minutes by default', async () => {
    process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = 'test-chat';
    const statePath = tempStatePath();
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

    const first = await sendSellerAlert({ key: 'same-key', title: '첫 알림', body: '내용', statePath, fetchImpl: fetchMock as any, nowMs: 10_000 });
    const second = await sendSellerAlert({ key: 'same-key', title: '두번째 알림', body: '내용', statePath, fetchImpl: fetchMock as any, nowMs: 10_000 + 29 * 60_000 });
    const third = await sendSellerAlert({ key: 'same-key', title: '세번째 알림', body: '내용', statePath, fetchImpl: fetchMock as any, nowMs: 10_000 + 31 * 60_000 });

    expect(first).toEqual({ sent: true, reason: 'sent' });
    expect(second).toEqual({ sent: false, reason: 'throttled' });
    expect(third).toEqual({ sent: true, reason: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('redacts likely sensitive values from alert text', async () => {
    process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = 'test-chat';
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

    await sendSellerAlert({
      key: 'sensitive',
      title: '세션 장애',
      body: 'JSESSIONID=abc123 token=secret password=hunter2 /home/ubuntu/secret-file',
      statePath: tempStatePath(),
      fetchImpl: fetchMock as any,
      nowMs: 1_000,
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.text).not.toContain('abc123');
    expect(payload.text).not.toContain('secret');
    expect(payload.text).not.toContain('hunter2');
    expect(payload.text).not.toContain('/home/ubuntu');
    expect(payload.text).toContain('[redacted]');
  });
});
