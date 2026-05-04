import { buildPartyAccessDeliveryTemplate } from '../lib/party-access-template';
import type { AutoReplyJobStore } from './auto-reply-jobs';

export const DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY = 'daily_account_access_notice';
export const OFF_HOURS_NOTICE_CATEGORY = 'off_hours_notice';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ACTIVE_NOTICE_STATUSES = new Set(['queued', 'drafted', 'sent', 'blocked']);

export function kstDayKey(now: Date | string = new Date()): string {
  const date = typeof now === 'string' ? new Date(now) : now;
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function kstHour(now: Date | string = new Date()): number {
  const date = typeof now === 'string' ? new Date(now) : now;
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

export function isKoreanBusinessHours(now: Date | string = new Date()): boolean {
  const hour = kstHour(now);
  return hour >= 14 && hour < 21;
}

function hasRoomNoticeForDay(store: AutoReplyJobStore, chatRoomUuid: string, category: string, now: Date | string): boolean {
  const day = kstDayKey(now);
  return Object.values(store.jobs || {}).some((job) => (
    job.chatRoomUuid === chatRoomUuid &&
    String(job.category || '').split(',').map((part) => part.trim()).includes(category) &&
    ACTIVE_NOTICE_STATUSES.has(String(job.status || '')) &&
    kstDayKey(job.createdAt || job.updatedAt || '') === day
  ));
}

export function shouldSendDailyAccountAccessNotice(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  if (!chatRoomUuid) return false;
  return !hasRoomNoticeForDay(store, chatRoomUuid, DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY, now);
}

export function shouldSendOffHoursNotice(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  if (!chatRoomUuid || isKoreanBusinessHours(now)) return false;
  return !hasRoomNoticeForDay(store, chatRoomUuid, OFF_HOURS_NOTICE_CATEGORY, now);
}

export function buildDailyAccountAccessNoticeReply(accessUrl: string): string {
  const url = String(accessUrl || '').trim();
  return [
    '로그인 관련 문의는 꼭 아래 계정 접근 주소를 먼저 참고해주세요.',
    buildPartyAccessDeliveryTemplate(url || '{각자 할당된 계정 확인 링크}'),
    '다른 파티원분들의 탈퇴 등으로 인해 계정 정보가 바뀔 수 있어, 해당 링크에서 업데이트된 정보로 로그인을 시도하셔야 합니다!',
    '로그인 외의 문제는, 다시 한 번 더 문의 남겨주세요.',
  ].join('\n');
}

export function buildOffHoursNoticeReply(): string {
  return '문의 시간은 14:00 ~ 21:00 라서, 최대한 빨리 답변드리도록 하겠습니다.';
}

export function combineNoticeReplies(parts: string[]): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n');
}

export function isSimpleAcknowledgement(message: string): boolean {
  const normalized = String(message || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[!~.。！？?ㅠㅜㅋㅎ♡♥️]/g, '')
    .trim();
  if (!normalized) return false;
  if (normalized.length > 12) return false;
  return /^(네|넵|넹|예|옙|ㅇㅋ|오케이|알겠습니다|확인|확인했습니다|감사합니다|감사|고맙습니다|고마워요|네감사합니다|넵감사합니다)$/.test(normalized);
}

export function hasDailyAccountAccessNoticeToday(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  return hasRoomNoticeForDay(store, chatRoomUuid, DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY, now);
}
