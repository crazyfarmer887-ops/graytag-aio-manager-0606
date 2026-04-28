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
  for (const field of ['recruitAgain', 'profileRemoved', 'devicesLoggedOut', 'passwordChanged', 'pinStillUnchanged', 'subscriptionKept', 'subscriptionCancelled', 'partyRestarted'] as const) {
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
  if (typeof patch.note === 'string') next.note = patch.note.slice(0, 500);

  if (next.recruitAgain === true) {
    next.subscriptionCancelled = null;
    if (next.subscriptionKept !== true) next.subscriptionBillingDay = '';
    if (next.passwordChanged !== true) next.changedPassword = '';
    if (next.pinStillUnchanged !== false && patch.generatedPin === undefined) {
      next.generatedPin = '';
      next.generatedPinAliasId = null;
      next.generatedPinAt = '';
    }
  } else if (next.recruitAgain === false) {
    next.profileRemoved = null;
    next.devicesLoggedOut = null;
    next.passwordChanged = null;
    next.changedPassword = '';
    next.pinStillUnchanged = null;
    next.generatedPin = '';
    next.generatedPinAliasId = null;
    next.generatedPinAt = '';
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
    const required = [state.subscriptionKept, state.profileRemoved, state.devicesLoggedOut, state.passwordChanged, state.pinStillUnchanged];
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

export function splitPartyMaintenanceChecklistItems<T extends PartyMaintenanceTargetLike>(
  items: Array<PartyMaintenanceChecklistItem<T>>,
): { active: Array<PartyMaintenanceChecklistItem<T>>; completed: Array<PartyMaintenanceChecklistItem<T>> } {
  return items.reduce<{ active: Array<PartyMaintenanceChecklistItem<T>>; completed: Array<PartyMaintenanceChecklistItem<T>> }>((acc, item) => {
    if (item.partyRestarted === true) acc.completed.push(item);
    else acc.active.push(item);
    return acc;
  }, { active: [], completed: [] });
}
