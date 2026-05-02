// ─── 구매 감지 폴링 데몬 ──────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { sendSellerAlert } from '../alerts/telegram';
import { extractGraytagChats, findLatestBuyerInquiryMessage, type GraytagChatMessage } from '../api/chat-message-summary';
import { messageFingerprint, normalizeBuyerMessage, type AutoReplyCandidateMessage } from '../api/auto-reply-message';

const POLL_SESSION_PATH = '/home/ubuntu/graytag-session/cookies.json';
const POLL_INTERVAL_MS = 30 * 1000;
const POLL_SESSION_MAX_AGE_MS = Number(process.env.POLL_SESSION_MAX_AGE_MS || 10 * 60 * 1000);
const KNOWN_DEALS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/known-deals.json';
const KNOWN_CHAT_MESSAGES_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/known-chat-messages.json';
const POLL_DAEMON_STATUS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/poll-daemon-status.json';
const POLL_FAILURE_ALERT_THRESHOLD = Number(process.env.POLL_FAILURE_ALERT_THRESHOLD || 3);

export function isPollSessionAlertEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['0', 'false', 'no', 'off'].includes(String(env.POLL_SESSION_ALERTS_ENABLED ?? 'true').trim().toLowerCase());
}

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://graytag.co.kr/lender/deal/list',
};

export function buildPollDealsUrl(page = 1, rows = 50): string {
  // Graytag 판매내역 now only exposes current 판매중 rows when "종료된 거래 포함" is enabled.
  return `https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=true&sorting=Latest&page=${page}&rows=${rows}`;
}

export function buildPollAfterUsingDealsUrl(page = 1, rows = 50): string {
  return `https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=${page}&rows=${rows}`;
}

function sessionCookieMtimeMs(): number | null {
  try {
    if (!existsSync(POLL_SESSION_PATH)) return null;
    return statSync(POLL_SESSION_PATH).mtimeMs;
  } catch {
    return null;
  }
}

export function isPollSessionFresh(mtimeMs: number | null, maxAgeMs = POLL_SESSION_MAX_AGE_MS, nowMs = Date.now()): boolean {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return false;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return true;
  return nowMs - mtimeMs <= maxAgeMs;
}

function loadSessionCookies(): { AWSALB: string; AWSALBCORS: string; JSESSIONID: string } | null {
  try {
    if (!existsSync(POLL_SESSION_PATH)) return null;
    const raw = JSON.parse(readFileSync(POLL_SESSION_PATH, 'utf8'));
    if (!raw.JSESSIONID) return null;
    return { AWSALB: raw.AWSALB || '', AWSALBCORS: raw.AWSALBCORS || '', JSESSIONID: raw.JSESSIONID };
  } catch { return null; }
}

function loadKnownDeals(): Record<string, string> {
  try {
    if (!existsSync(KNOWN_DEALS_PATH)) return {};
    return JSON.parse(readFileSync(KNOWN_DEALS_PATH, 'utf8'));
  } catch { return {}; }
}

function saveKnownDeals(d: Record<string, string>) {
  try {
    const dir = KNOWN_DEALS_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(KNOWN_DEALS_PATH, JSON.stringify(d, null, 2), 'utf8');
  } catch {}
}

function loadKnownChatMessages(): Record<string, string> {
  try {
    if (!existsSync(KNOWN_CHAT_MESSAGES_PATH)) return {};
    const parsed = JSON.parse(readFileSync(KNOWN_CHAT_MESSAGES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function saveKnownChatMessages(d: Record<string, string>) {
  try {
    const dir = KNOWN_CHAT_MESSAGES_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(KNOWN_CHAT_MESSAGES_PATH, JSON.stringify(d, null, 2), 'utf8');
  } catch {}
}

export interface PollChatDeal {
  dealUsid?: string;
  productUsid?: string;
  chatRoomUuid?: string;
  borrowerName?: string;
  productTypeString?: string;
  productName?: string;
  keepAcct?: string;
  lenderChatUnread?: boolean;
  dealDetail?: { lenderChatUnread?: boolean; chatRoomUuid?: string };
}

export interface PollChatAlertCandidate {
  fingerprint: string;
  chatRoomUuid: string;
  dealUsid: string;
  borrowerName: string;
  productType: string;
  productName: string;
  keepAcct: string;
  text: string;
  timestamp: string;
}

export function buildNewChatAlertCandidate(
  deal: PollChatDeal,
  message: GraytagChatMessage | undefined,
  known: Record<string, string>,
): PollChatAlertCandidate | null {
  const chatRoomUuid = String(deal.chatRoomUuid || deal.dealDetail?.chatRoomUuid || '').trim();
  if (!chatRoomUuid || !message?.message) return null;
  const candidate: AutoReplyCandidateMessage = {
    chatRoomUuid,
    dealUsid: String(deal.dealUsid || deal.productUsid || ''),
    buyerName: deal.borrowerName,
    productType: deal.productTypeString,
    productName: deal.productName,
    message: message.message,
    registeredDateTime: message.registeredDateTime,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    owned: message.owned,
    isOwned: message.isOwned,
    informationMessage: message.informationMessage,
    isInfo: message.isInfo,
    messageType: message.messageType,
  };
  const fp = messageFingerprint(candidate);
  if (!fp || known[fp]) return null;
  const text = normalizeBuyerMessage(message.message).slice(0, 800);
  if (!text) return null;
  return {
    fingerprint: fp,
    chatRoomUuid,
    dealUsid: candidate.dealUsid || '',
    borrowerName: deal.borrowerName?.trim() || '(구매자 미확인)',
    productType: deal.productTypeString || '(서비스 미확인)',
    productName: deal.productName || '',
    keepAcct: deal.keepAcct || '',
    text,
    timestamp: candidate.registeredDateTime || candidate.createdAt || candidate.updatedAt || new Date().toISOString(),
  };
}

function loadPollStatus(): any {
  try {
    if (!existsSync(POLL_DAEMON_STATUS_PATH)) return {};
    return JSON.parse(readFileSync(POLL_DAEMON_STATUS_PATH, 'utf8'));
  } catch { return {}; }
}

function savePollStatus(status: any): void {
  try {
    const dir = POLL_DAEMON_STATUS_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(POLL_DAEMON_STATUS_PATH, JSON.stringify(status, null, 2), 'utf8');
  } catch {}
}

function recordPollSuccess(): void {
  savePollStatus({ ...loadPollStatus(), ok: true, lastSuccess: new Date().toISOString(), lastError: null, consecutiveFailures: 0 });
}

async function recordPollFailure(reason: string, alertKey: string, severity: 'warning' | 'critical' = 'warning'): Promise<void> {
  const prev = loadPollStatus();
  const consecutiveFailures = Number(prev?.consecutiveFailures || 0) + 1;
  savePollStatus({
    ...prev,
    ok: false,
    lastError: reason,
    lastFailure: new Date().toISOString(),
    consecutiveFailures,
  });

  const isSessionAlert = alertKey.includes('session');
  if (isSessionAlert && !isPollSessionAlertEnabled()) {
    console.warn('[PollDaemon] 세션 쿠키 장애 알림 비활성화됨');
    return;
  }

  if (consecutiveFailures >= POLL_FAILURE_ALERT_THRESHOLD || isSessionAlert) {
    const result = await sendSellerAlert({
      key: alertKey,
      title: 'PollDaemon 확인 필요',
      body: `${reason}\n연속 실패: ${consecutiveFailures}회`,
      severity,
    });
    if (result.reason === 'failed') console.error('[PollDaemon] 장애 알림 전송 실패');
  }
}

function extractLenderDeals(payload: any): any[] {
  const candidates = [
    payload?.data?.lenderDeals,
    payload?.lenderDeals,
    payload?.data?.data,
    payload?.data,
  ];
  return candidates.find(Array.isArray) || [];
}

async function sendNewChatMessageAlerts(deals: PollChatDeal[], headers: Record<string, string>): Promise<number> {
  const known = loadKnownChatMessages();
  const updated = { ...known };
  let sent = 0;
  const seenRooms = new Set<string>();
  const chatDeals = deals.filter((deal) => {
    const room = String(deal.chatRoomUuid || deal.dealDetail?.chatRoomUuid || '').trim();
    if (!room || seenRooms.has(room)) return false;
    seenRooms.add(room);
    return Boolean(deal.lenderChatUnread || deal.dealDetail?.lenderChatUnread);
  }).slice(0, 25);

  for (const deal of chatDeals) {
    const chatRoomUuid = String(deal.chatRoomUuid || deal.dealDetail?.chatRoomUuid || '').trim();
    try {
      const msgResp = await fetch(`https://graytag.co.kr/ws/chat/findChats?uuid=${encodeURIComponent(chatRoomUuid)}&page=1`, {
        headers: { ...headers, Referer: `https://graytag.co.kr/chat/${chatRoomUuid}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(2500),
      });
      if (!msgResp.ok) continue;
      const msgJson = await msgResp.json() as any;
      const alert = buildNewChatAlertCandidate(deal, findLatestBuyerInquiryMessage(extractGraytagChats(msgJson)), updated);
      if (!alert) continue;
      updated[alert.fingerprint] = alert.timestamp;
      const accountLine = alert.keepAcct ? `\n계정: ${alert.keepAcct}` : '';
      const dealLine = alert.dealUsid ? `\nUSID: ${alert.dealUsid}` : '';
      const result = await sendSellerAlert({
        key: `graytag-chat-${alert.fingerprint}`,
        title: 'Graytag 새 문자',
        body: `${alert.productType} · ${alert.borrowerName}${accountLine}${dealLine}\n시간: ${alert.timestamp}\n메시지: ${alert.text}`,
        throttleMs: 0,
      });
      if (result.sent) sent += 1;
    } catch (e: any) {
      console.warn('[PollDaemon] 채팅 알림 확인 실패:', e?.message || e);
    }
  }

  saveKnownChatMessages(updated);
  return sent;
}

async function pollGraytag() {
  process.stderr.write('[PollDaemon] 폴링 실행 ' + new Date().toISOString() + '\n');
  try {
    const cookies = loadSessionCookies();
    if (!cookies) {
      console.log('[PollDaemon] 세션 쿠키 없음 — 스킵');
      await recordPollFailure('세션 쿠키 없음', 'poll-daemon-session-missing', 'critical');
      return;
    }
    if (!isPollSessionFresh(sessionCookieMtimeMs())) {
      console.log('[PollDaemon] 세션 쿠키 오래됨 — 스킵');
      await recordPollFailure('세션 쿠키 오래됨 또는 stale 상태', 'poll-daemon-session-stale', 'critical');
      return;
    }

    const cookieStr = `AWSALB=${cookies.AWSALB}; AWSALBCORS=${cookies.AWSALBCORS}; JSESSIONID=${cookies.JSESSIONID}`;
    const headers = { ...BASE_HEADERS, Cookie: cookieStr };

    const resp = await fetch(
      buildPollDealsUrl(),
      { headers }
    );
    const afterResp = await fetch(
      buildPollAfterUsingDealsUrl(),
      { headers: { ...headers, Referer: 'https://graytag.co.kr/lender/deal/listAfterUsing' } }
    );
    if (!resp.ok) {
      console.log('[PollDaemon] API 실패:', resp.status);
      await recordPollFailure(`Graytag API HTTP ${resp.status}`, 'poll-daemon-api-failure', resp.status >= 500 ? 'critical' : 'warning');
      return;
    }

    const json = await resp.json() as any;
    if (!json.succeeded) {
      console.log('[PollDaemon] API succeeded=false');
      await recordPollFailure('Graytag API succeeded=false', 'poll-daemon-api-failure');
      return;
    }

    const deals: any[] = json.data?.lenderDeals ?? [];
    let allDealsForChatAlerts: any[] = deals;
    if (afterResp.ok) {
      const afterJson = await afterResp.json() as any;
      allDealsForChatAlerts = [...deals, ...extractLenderDeals(afterJson)];
    } else {
      console.log('[PollDaemon] 사용중 채팅 API 실패:', afterResp.status);
    }
    const known = loadKnownDeals();
    const updated: Record<string, string> = { ...known };
    const alerts: string[] = [];

    for (const deal of deals) {
      const usid: string = deal.productUsid;
      const status: string = deal.dealStatus;
      const prev = known[usid];

      if (prev === undefined) { updated[usid] = status; continue; }

      if (prev !== status) {
        updated[usid] = status;
        if (prev === 'OnSale' && status !== 'OnSale') {
          const ott = deal.productTypeString ?? '';
          const borrower = deal.borrowerName ?? '(미확인)';
          const name = (deal.productName ?? '').slice(0, 30);
          alerts.push(`\uD83D\uDED2 <b>\uC0C8 \uAD6C\uB9E4 \uBC1C\uC0DD!</b>\n${ott} \u2014 ${name}\n\uAD6C\uB9E4\uC790: ${borrower}\nUSID: <code>${usid}</code>\n\uC0C1\uD0DC: ${status}`);
        }
      }

      if (status === 'ExtensionWaiting' && deal.productKeepAcctYn === false) {
        const warnKey = 'ext_warned_' + usid;
        if (!known[warnKey]) {
          updated[warnKey] = 'warned';
          const ott = deal.productTypeString ?? '';
          alerts.push(`\u26A0\uFE0F <b>\uC5F0\uC7A5 \uB300\uAE30 \u2014 keepAcct \uC5C6\uC74C!</b>\n${ott} USID: <code>${usid}</code>\n\uACC4\uC815 \uC815\uBCF4\uB97C \uC124\uC815\uD574\uC8FC\uC138\uC694.`);
        }
      }
    }

    for (const msg of alerts) {
      await sendSellerAlert({
        key: 'poll-daemon-deal-' + msg.slice(-80),
        title: 'Graytag 판매 이벤트',
        body: msg.replace(/<[^>]+>/g, ''),
      });
      console.log('[PollDaemon] 알림 전송:', msg.slice(0, 50));
    }

    saveKnownDeals(updated);
    const chatAlertCount = await sendNewChatMessageAlerts(allDealsForChatAlerts, headers);
    if (chatAlertCount > 0) console.log('[PollDaemon] 채팅 알림 전송:', chatAlertCount);
    recordPollSuccess();
  } catch (e: any) {
    console.error('[PollDaemon] 폴링 에러:', e.message);
    await recordPollFailure(`PollDaemon 예외: ${e.message}`, 'poll-daemon-exception', 'critical');
  }
}

export function startPollDaemon(): void {
  setTimeout(async () => {
    console.log('[PollDaemon] 구매 감지 폴링 시작 (30초 간격)');
    await pollGraytag();
    setInterval(pollGraytag, POLL_INTERVAL_MS);
  }, 5000);
  console.log('[PollDaemon] 초기화 완료');
}
