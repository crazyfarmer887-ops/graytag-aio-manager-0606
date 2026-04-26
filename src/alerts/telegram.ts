import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export type SellerAlertResult =
  | { sent: true; reason: 'sent' }
  | { sent: false; reason: 'disabled' | 'throttled' | 'failed' };

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>;

export type SellerAlertInput = {
  key: string;
  title: string;
  body: string;
  severity?: 'warning' | 'critical';
  statePath?: string;
  throttleMs?: number;
  nowMs?: number;
  fetchImpl?: FetchLike;
};

const DEFAULT_ALERT_STATE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/alert-state.json';
const DEFAULT_THROTTLE_MS = 30 * 60 * 1000;

type AlertState = { sentAtByKey?: Record<string, number> };

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function loadState(path: string): AlertState {
  try {
    if (!existsSync(path)) return { sentAtByKey: {} };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw && typeof raw === 'object' ? raw : { sentAtByKey: {} };
  } catch {
    return { sentAtByKey: {} };
  }
}

function saveState(path: string, state: AlertState): void {
  try {
    const dir = path.replace(/\/[^/]+$/, '');
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ sentAtByKey: state.sentAtByKey || {} }, null, 2), 'utf8');
  } catch {
    // Alerting must never break the dashboard/daemon path.
  }
}

export function sanitizeAlertText(raw: string): string {
  return String(raw || '')
    .replace(/(JSESSIONID|AWSALB|AWSALBCORS|sessionId|token|secret|password|passwd|pw|authorization|cookie)\s*[=:]\s*[^\s\n;,&]+/gi, '$1=[redacted]')
    .replace(/\/home\/[^\s\n"']+/g, '[path]')
    .replace(/\/tmp\/[^\s\n"']+/g, '[path]')
    .replace(/\/var\/[^\s\n"']+/g, '[path]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[ip]')
    .slice(0, 3500);
}

function buildText(input: SellerAlertInput): string {
  const icon = input.severity === 'critical' ? '🚨' : '⚠️';
  const title = sanitizeAlertText(input.title).replace(/[<>]/g, '');
  const body = sanitizeAlertText(input.body);
  return `${icon} [AIO Seller] ${title}\n${body}`.trim();
}

export async function sendSellerAlert(input: SellerAlertInput): Promise<SellerAlertResult> {
  const botToken = env('SELLER_ALERT_TELEGRAM_BOT_TOKEN');
  const chatId = env('SELLER_ALERT_TELEGRAM_CHAT_ID');
  if (!botToken || !chatId) return { sent: false, reason: 'disabled' };

  const statePath = input.statePath || DEFAULT_ALERT_STATE_PATH;
  const throttleMs = input.throttleMs ?? DEFAULT_THROTTLE_MS;
  const nowMs = input.nowMs ?? Date.now();
  const key = sanitizeAlertText(input.key).slice(0, 200);
  const state = loadState(statePath);
  const sentAtByKey = state.sentAtByKey || {};
  const lastSentAt = Number(sentAtByKey[key] || 0);

  if (throttleMs > 0 && lastSentAt > 0 && nowMs - lastSentAt < throttleMs) {
    return { sent: false, reason: 'throttled' };
  }

  const fetcher = input.fetchImpl || (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetcher) return { sent: false, reason: 'failed' };

  try {
    const res = await fetcher(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: buildText(input), disable_web_page_preview: true }),
    });
    if (!res.ok) return { sent: false, reason: 'failed' };
    sentAtByKey[key] = nowMs;
    saveState(statePath, { sentAtByKey });
    return { sent: true, reason: 'sent' };
  } catch {
    return { sent: false, reason: 'failed' };
  }
}
