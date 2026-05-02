export type MaintenanceChecklistAnswer = boolean | null;

export interface PartyMaintenanceTargetLike {
  key: string;
  serviceType: string;
  accountEmail: string;
}

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const PASSWORD_SYMBOLS = '!@';
const PASSWORD_TAIL = `${LOWERCASE}${DIGITS}${PASSWORD_SYMBOLS}`;

function pickChar(chars: string, random: () => number): string {
  return chars[Math.min(chars.length - 1, Math.floor(random() * chars.length))] || chars[0];
}

export function generateMaintenancePassword(random = Math.random): string {
  const chars = Array.from({ length: 12 }, (_, index) => index === 0 ? pickChar(LOWERCASE, random) : pickChar(PASSWORD_TAIL, random));
  chars[5] = pickChar(DIGITS, random);
  chars[8] = '!';
  chars[10] = '@';
  return chars.join('');
}

export interface PartyMaintenanceChecklistState {
  key: string;
  recruitAgain: MaintenanceChecklistAnswer;
  profileRemoved: MaintenanceChecklistAnswer;
  devicesLoggedOut: MaintenanceChecklistAnswer;
  passwordChanged: MaintenanceChecklistAnswer;
  changedPassword: string;
  pinStillUnchanged: MaintenanceChecklistAnswer;
  generatedPin: string;
  generatedPinAliasId: number | string | null;
  generatedPinAt: string;
  subscriptionKept: MaintenanceChecklistAnswer;
  subscriptionBillingDay: string;
  subscriptionCancelled: MaintenanceChecklistAnswer;
  partyRestarted: MaintenanceChecklistAnswer;
  noticeSent: MaintenanceChecklistAnswer;
  noticeTemplate: string;
  noticeSentAt: string;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PartyMaintenanceChecklistItem<T extends PartyMaintenanceTargetLike = PartyMaintenanceTargetLike> extends PartyMaintenanceChecklistState {
  target: T;
  progress: { done: number; total: number };
  nextAction: string;
}

export type PartyMaintenanceChecklistStore = Record<string, PartyMaintenanceChecklistState>;

const DEFAULT_STATE = {
  recruitAgain: null,
  profileRemoved: null,
  devicesLoggedOut: null,
  passwordChanged: null,
  changedPassword: '',
  pinStillUnchanged: null,
  generatedPin: '',
  generatedPinAliasId: null,
  generatedPinAt: '',
  subscriptionKept: null,
  subscriptionBillingDay: '',
  subscriptionCancelled: null,
  partyRestarted: null,
  noticeSent: null,
  noticeTemplate: '',
  noticeSentAt: '',
  note: '',
};

export function partyMaintenanceChecklistKey(target: PartyMaintenanceTargetLike): string {
  return target.key || `${target.serviceType}:${target.accountEmail}`;
}

export function createDefaultPartyMaintenanceChecklistState(key: string): PartyMaintenanceChecklistState {
  return { key, ...DEFAULT_STATE, updatedAt: '', updatedBy: '' };
}

function normalizeNullableBoolean(value: unknown): MaintenanceChecklistAnswer | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (value === null) return null;
  return undefined;
}

function normalizeBillingDay(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  const day = Number(digits);
  if (!Number.isInteger(day) || day < 1 || day > 31) return '';
  return String(day);
}

function normalizeSixDigitPin(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const digits = String(value).replace(/\D/g, '').slice(0, 6);
  return digits.length === 6 ? digits : '';
}

export function mergePartyMaintenanceChecklistState(
  store: PartyMaintenanceChecklistStore,
  key: string,
  patch: Partial<PartyMaintenanceChecklistState>,
  updatedBy = 'dashboard',
  now = new Date().toISOString(),
): PartyMaintenanceChecklistStore {
  const current = { ...createDefaultPartyMaintenanceChecklistState(key), ...(store[key] || {}), key };
  const next: PartyMaintenanceChecklistState = { ...current, key };
  for (const field of ['recruitAgain', 'profileRemoved', 'devicesLoggedOut', 'passwordChanged', 'pinStillUnchanged', 'subscriptionKept', 'subscriptionCancelled', 'partyRestarted', 'noticeSent'] as const) {
    const value = normalizeNullableBoolean(patch[field]);
    if (value !== undefined) next[field] = value;
  }
  const billingDay = normalizeBillingDay(patch.subscriptionBillingDay);
  if (billingDay !== undefined) next.subscriptionBillingDay = billingDay;
  if (typeof patch.changedPassword === 'string') next.changedPassword = patch.changedPassword.slice(0, 200);
  const generatedPin = normalizeSixDigitPin(patch.generatedPin);
  if (generatedPin !== undefined) next.generatedPin = generatedPin;
  if (patch.generatedPinAliasId !== undefined) next.generatedPinAliasId = patch.generatedPinAliasId ?? null;
  if (typeof patch.generatedPinAt === 'string') next.generatedPinAt = patch.generatedPinAt.slice(0, 60);
  if (typeof patch.noticeTemplate === 'string') next.noticeTemplate = patch.noticeTemplate.slice(0, 2000);
  if (typeof patch.noticeSentAt === 'string') next.noticeSentAt = patch.noticeSentAt.slice(0, 60);
  if (typeof patch.note === 'string') next.note = patch.note.slice(0, 500);
  if (patch.noticeSent === true && current.noticeSent !== true) next.noticeSentAt = now;
  if (patch.noticeSent === false || patch.noticeSent === null) next.noticeSentAt = '';

  if (next.recruitAgain === true) {
    next.subscriptionCancelled = null;
    if (next.subscriptionKept !== true) next.subscriptionBillingDay = '';
    if (next.passwordChanged !== true) next.changedPassword = '';
    if (next.pinStillUnchanged !== false && patch.generatedPin === undefined) {
      next.generatedPin = '';
      next.generatedPinAliasId = null;
      next.generatedPinAt = '';
    }
    if (next.noticeSent !== true) next.noticeSentAt = '';
  } else if (next.recruitAgain === false) {
    next.profileRemoved = null;
    next.devicesLoggedOut = null;
    next.passwordChanged = null;
    next.changedPassword = '';
    next.pinStillUnchanged = null;
    next.generatedPin = '';
    next.generatedPinAliasId = null;
    next.generatedPinAt = '';
    next.noticeSent = null;
    next.noticeTemplate = '';
    next.noticeSentAt = '';
    next.subscriptionKept = null;
    next.subscriptionBillingDay = '';
    next.partyRestarted = null;
  } else {
    next.partyRestarted = null;
  }

  next.updatedAt = now;
  next.updatedBy = updatedBy;
  return { ...store, [key]: next };
}

function buildProgress(state: PartyMaintenanceChecklistState): { done: number; total: number } {
  let done = state.recruitAgain !== null ? 1 : 0;
  let total = 1;
  if (state.recruitAgain === true) {
    const required = [state.subscriptionKept, state.profileRemoved, state.devicesLoggedOut, state.passwordChanged, state.pinStillUnchanged, state.noticeSent];
    done += required.filter((value) => value !== null).length;
    total += required.length;
    if (state.subscriptionKept === true) {
      total += 1;
      if (state.subscriptionBillingDay.trim()) done += 1;
    }
    if (state.passwordChanged === true) {
      total += 1;
      if (state.changedPassword.trim()) done += 1;
    }
    if (state.pinStillUnchanged === true || state.generatedPin.trim()) {
      total += 1;
      if (state.generatedPin.trim()) done += 1;
    }
  } else if (state.recruitAgain === false) {
    done += state.subscriptionCancelled !== null ? 1 : 0;
    total += 1;
  }
  return { done, total };
}

function nextActionFor(state: PartyMaintenanceChecklistState): string {
  if (state.recruitAgain === null) return '재모집 여부 선택';
  if (state.recruitAgain === false) return state.subscriptionCancelled === true ? '해지 확인 완료' : '구독 해지 여부 확인';
  if (state.subscriptionKept === null) return '기존 구독 유지 여부 확인';
  if (state.subscriptionKept === true && !state.subscriptionBillingDay.trim()) return '구독 결제일 입력';
  if (state.profileRemoved !== true) return '기존 파티원 프로필 제거';
  if (state.devicesLoggedOut !== true) return '모든 기기 로그아웃';
  if (state.passwordChanged === null) return '비밀번호 변경 여부 확인';
  if (state.passwordChanged === true && !state.changedPassword.trim()) return '변경된 비밀번호 입력';
  if (state.pinStillUnchanged === null) return 'PIN 변경 여부 확인';
  if (state.pinStillUnchanged === true && !state.generatedPin.trim()) return '랜덤 PIN 재생성';
  if (state.noticeSent !== true) return '남은 파티원 공지';
  if (state.partyRestarted !== true) return '파티 재시작 여부 확인';
  return '파티 재시작 완료';
}

export function buildPartyMaintenanceChecklistItems<T extends PartyMaintenanceTargetLike>(
  targets: T[],
  store: PartyMaintenanceChecklistStore = {},
): Array<PartyMaintenanceChecklistItem<T>> {
  return targets.map((target) => {
    const key = partyMaintenanceChecklistKey(target);
    const state = { ...createDefaultPartyMaintenanceChecklistState(key), ...(store[key] || {}), key };
    return {
      ...state,
      key,
      target,
      progress: buildProgress(state),
      nextAction: nextActionFor(state),
    };
  });
}



export interface PartyNoticeMemberLike {
  name?: string | null;
  dealUsid?: string | null;
  endDateTime?: string | null;
  status?: string | null;
  statusName?: string | null;
}

export interface PartyNoticeTemplateInput {
  serviceType: string;
  accountEmail: string;
  password?: string;
  pin?: string;
  members?: PartyNoticeMemberLike[];
}

function normalizeNoticeDate(value: string | null | undefined): string {
  if (!value) return '';
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = value.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const short = value.replace(/\s/g, '').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (short) {
    const yy = Number(short[1]);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return `${year}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}`;
  }
  return '';
}

function isNoticeEligibleMember(member: PartyNoticeMemberLike): boolean {
  const status = String(member.status || '');
  const label = String(member.statusName || '');
  return status === 'Using' || status === 'UsingNearExpiration' || status === 'DeliveredAndCheckPrepaid' || label.includes('계정확인중') || label.includes('계정 확인중');
}

export function buildPartyNoticeTemplate(input: PartyNoticeTemplateInput): {
  text: string;
  remainingMemberNames: string[];
  excludedMemberNames: string[];
  excludedDealUsids: string[];
  earliestEndDate: string;
} {
  const eligible = (input.members || []).filter(isNoticeEligibleMember);
  const endDates = eligible.map((member) => normalizeNoticeDate(member.endDateTime)).filter(Boolean).sort();
  const earliestEndDate = endDates[0] || '';
  const shouldExcludeEarliest = Boolean(earliestEndDate && endDates.some((date) => date > earliestEndDate));
  const excluded = shouldExcludeEarliest ? eligible.filter((member) => normalizeNoticeDate(member.endDateTime) === earliestEndDate) : [];
  const excludedIds = new Set(excluded.map((member) => String(member.dealUsid || '')).filter(Boolean));
  const remaining = eligible.filter((member) => !excludedIds.has(String(member.dealUsid || '')));
  const remainingMemberNames = remaining.map((member) => String(member.name || '(미확인)').trim() || '(미확인)');
  const excludedMemberNames = excluded.map((member) => String(member.name || '(미확인)').trim() || '(미확인)');
  const lines = [
    `안녕하세요. ${input.serviceType} 파티 계정 보안 재정비 안내드립니다.`,
    '',
    '파티 이용기간이 먼저 끝나는 분들은 제외하고, 남은 파티원 대상으로 계정 정보가 변경됩니다.',
    remainingMemberNames.length ? `남은 파티원: ${remainingMemberNames.join(', ')}` : '남은 파티원: 현재 확인된 이용중 파티원 전체',
    excludedMemberNames.length ? `제외 대상(먼저 종료): ${excludedMemberNames.join(', ')}${earliestEndDate ? ` · ${earliestEndDate}` : ''}` : '',
    '',
    '비밀번호가 재설정되었습니다.',
    input.password ? `새 비밀번호: ${input.password}` : '새 비밀번호: {새 비밀번호}',
    input.pin ? `이메일 인증 PIN: ${input.pin}` : '이메일 인증 PIN: {PIN 번호}',
    '',
    '기존에 로그인되어 있던 기기에서는 다시 로그인해 주세요.',
    '1인 1기기 1계정 원칙은 그대로 유지됩니다.',
  ].filter((line) => line !== '');
  return { text: lines.join('\n'), remainingMemberNames, excludedMemberNames, excludedDealUsids: [...excludedIds], earliestEndDate };
}

export function splitPartyMaintenanceChecklistItems<T extends PartyMaintenanceTargetLike>(
  items: Array<PartyMaintenanceChecklistItem<T>>,
): { active: Array<PartyMaintenanceChecklistItem<T>>; completed: Array<PartyMaintenanceChecklistItem<T>> } {
  return items.reduce<{ active: Array<PartyMaintenanceChecklistItem<T>>; completed: Array<PartyMaintenanceChecklistItem<T>> }>((acc, item) => {
    if (item.partyRestarted === true) acc.completed.push(item);
    else acc.active.push(item);
    return acc;
  }, { active: [], completed: [] });
}
