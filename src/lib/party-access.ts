import { createHash } from 'node:crypto';
import type { GeneratedAccountStore } from './generated-accounts';
import type { PartyMaintenanceChecklistStore } from './party-maintenance-checklist';
export { buildPartyAccessDeliveryTemplate } from './party-access-template';

export type PartyAccessMemberKind = 'graytag' | 'manual';

export interface PartyAccessMemberRef {
  kind: PartyAccessMemberKind;
  memberId: string;
  memberName: string;
  status: string;
  statusName?: string;
  startDateTime?: string | null;
  endDateTime?: string | null;
}

export interface PartyAccessLinkRecord {
  id: string;
  tokenHash: string;
  serviceType: string;
  accountEmail: string;
  fallbackPassword: string;
  fallbackPin: string;
  profileName: string;
  emailAccessUrl: string;
  member: PartyAccessMemberRef;
  createdAt: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
}

export type PartyAccessLinkStore = Record<string, PartyAccessLinkRecord>;

export interface PartyAccessCredentials {
  id: string;
  password: string;
  pin: string;
  updatedAt: string;
}

const ENDED_STATUS_PATTERNS = [
  /^Finished/i,
  /^Cancel/i,
  /^Deleted$/i,
  /^Expired$/i,
  /^cancelled$/i,
  /^expired$/i,
  /종료/,
  /취소/,
  /만료/,
  /삭제/,
];

export function normalizePartyAccessToken(token: string): string {
  return String(token || '').trim().replace(/[^A-Za-z0-9._~-]/g, '');
}

export function partyAccessTokenHash(token: string): string {
  return createHash('sha256').update(normalizePartyAccessToken(token)).digest('hex');
}

function normalizeKeyPart(value: string): string {
  return String(value || '').trim();
}

export function partyAccessAccountKey(serviceType: string, accountEmail: string): string {
  return `${normalizeKeyPart(serviceType)}:${normalizeKeyPart(accountEmail)}`;
}

function parseDateEndOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T23:59:59.999Z`);
  const short = raw.replace(/\s/g, '').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (short) {
    const yy = Number(short[1]);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return new Date(`${year}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}T23:59:59.999Z`);
  }
  const m = raw.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T23:59:59.999Z`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isEndedStatus(status: string, statusName = ''): boolean {
  const text = `${status || ''} ${statusName || ''}`.trim();
  return ENDED_STATUS_PATTERNS.some((pattern) => pattern.test(text));
}

export function createPartyAccessLinkRecord(input: {
  token: string;
  now?: string;
  serviceType: string;
  accountEmail: string;
  fallbackPassword?: string;
  fallbackPin?: string;
  profileName?: string;
  emailAccessUrl?: string;
  member: PartyAccessMemberRef;
}): PartyAccessLinkRecord {
  const now = input.now || new Date().toISOString();
  const tokenHash = partyAccessTokenHash(input.token);
  const memberId = normalizeKeyPart(input.member.memberId);
  return {
    id: `${partyAccessAccountKey(input.serviceType, input.accountEmail)}:${input.member.kind}:${memberId}:${tokenHash.slice(0, 12)}`,
    tokenHash,
    serviceType: normalizeKeyPart(input.serviceType),
    accountEmail: normalizeKeyPart(input.accountEmail),
    fallbackPassword: String(input.fallbackPassword || '').slice(0, 300),
    fallbackPin: String(input.fallbackPin || '').replace(/\D/g, '').slice(0, 6),
    profileName: normalizeKeyPart(input.profileName || input.member.memberName || '(미확인)').slice(0, 40),
    emailAccessUrl: normalizeKeyPart(input.emailAccessUrl || '').slice(0, 500),
    member: {
      kind: input.member.kind,
      memberId,
      memberName: normalizeKeyPart(input.member.memberName || '(미확인)'),
      status: normalizeKeyPart(input.member.status),
      statusName: normalizeKeyPart(input.member.statusName || input.member.status),
      startDateTime: input.member.startDateTime || null,
      endDateTime: input.member.endDateTime || null,
    },
    createdAt: now,
    revokedAt: null,
    lastViewedAt: null,
    viewCount: 0,
  };
}

export function isPartyAccessAllowed(record: PartyAccessLinkRecord, now = new Date().toISOString()): { allowed: boolean; reason: 'active' | 'revoked' | 'ended-status' | 'expired' | 'missing-record' } {
  if (!record) return { allowed: false, reason: 'missing-record' };
  if (record.revokedAt) return { allowed: false, reason: 'revoked' };
  if (isEndedStatus(record.member.status, record.member.statusName)) return { allowed: false, reason: 'ended-status' };
  const end = parseDateEndOfDay(record.member.endDateTime);
  if (end && end.getTime() < new Date(now).getTime()) return { allowed: false, reason: 'expired' };
  return { allowed: true, reason: 'active' };
}

function findGeneratedAccount(store: GeneratedAccountStore, serviceType: string, accountEmail: string) {
  const exactKey = partyAccessAccountKey(serviceType, accountEmail);
  const lowerEmail = normalizeKeyPart(accountEmail).toLowerCase();
  return Object.values(store || {}).find((account) => {
    const accountAny = account as any;
    if (partyAccessAccountKey(accountAny.serviceType, accountAny.email) === exactKey) return true;
    if (normalizeKeyPart(accountAny.email).toLowerCase() === lowerEmail && normalizeKeyPart(accountAny.serviceType) === normalizeKeyPart(serviceType)) return true;
    if (normalizeKeyPart(accountAny.email).toLowerCase() === lowerEmail && normalizeKeyPart(accountAny.sourceServiceType || '') === normalizeKeyPart(serviceType)) return true;
    return false;
  });
}

export function resolvePartyAccessCredentials(
  record: PartyAccessLinkRecord,
  checklistStore: PartyMaintenanceChecklistStore = {},
  generatedStore: GeneratedAccountStore = {},
): PartyAccessCredentials {
  const key = partyAccessAccountKey(record.serviceType, record.accountEmail);
  const state = checklistStore[key];
  const generated = findGeneratedAccount(generatedStore, record.serviceType, record.accountEmail) as any;
  const password = String(state?.changedPassword || record.fallbackPassword || generated?.password || '').trim();
  const pin = String(state?.generatedPin || record.fallbackPin || generated?.pin || '').trim();
  const updatedAt = String(state?.updatedAt || generated?.createdAt || record.createdAt || '');
  return { id: record.accountEmail, password, pin, updatedAt };
}

export function buildPartyAccessPublicPayload(
  record: PartyAccessLinkRecord | null,
  checklistStore: PartyMaintenanceChecklistStore = {},
  generatedStore: GeneratedAccountStore = {},
  now = new Date().toISOString(),
): {
  ok: boolean;
  reason?: string;
  serviceType?: string;
  accountEmail?: string;
  memberName?: string;
  profileName?: string;
  emailAccessUrl?: string;
  period?: { startDateTime: string | null; endDateTime: string | null };
  credentials?: PartyAccessCredentials;
  audit: { memberId: string; allowed: boolean; reason: string; viewedAt: string };
} {
  if (!record) {
    return { ok: false, reason: 'not-found', audit: { memberId: '', allowed: false, reason: 'missing-record', viewedAt: now } };
  }
  const allowed = isPartyAccessAllowed(record, now);
  const base = {
    serviceType: record.serviceType,
    accountEmail: record.accountEmail,
    memberName: record.member.memberName,
    profileName: record.profileName || record.member.memberName,
    emailAccessUrl: record.emailAccessUrl || '',
    period: { startDateTime: record.member.startDateTime || null, endDateTime: record.member.endDateTime || null },
    audit: { memberId: record.member.memberId, allowed: allowed.allowed, reason: allowed.reason, viewedAt: now },
  };
  if (!allowed.allowed) return { ok: false, reason: allowed.reason, ...base };
  return { ok: true, ...base, credentials: resolvePartyAccessCredentials(record, checklistStore, generatedStore) };
}
