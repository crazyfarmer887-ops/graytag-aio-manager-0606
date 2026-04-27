export interface ExpiredPartySourceItem {
  dealUsid: string;
  serviceType: string;
  accountEmail: string;
  memberName: string;
  status: string;
  statusName: string;
  endDate: string;
  price: string;
  source: 'graytag' | 'manual';
}

export type ChecklistAnswer = boolean | null;

export interface ExpiredPartyChecklistState {
  key: string;
  recruitAgain: ChecklistAnswer;
  profileRemoved: ChecklistAnswer;
  devicesLoggedOut: ChecklistAnswer;
  passwordChanged: ChecklistAnswer;
  pinChanged: ChecklistAnswer;
  subscriptionCancelled: ChecklistAnswer;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ExpiredPartyChecklistItem extends ExpiredPartySourceItem, ExpiredPartyChecklistState {
  progress: { done: number; total: number };
  nextAction: string;
}

export type ExpiredPartyChecklistStore = Record<string, ExpiredPartyChecklistState>;

const DEFAULT_STATE = {
  recruitAgain: null,
  profileRemoved: null,
  devicesLoggedOut: null,
  passwordChanged: null,
  pinChanged: null,
  subscriptionCancelled: null,
  note: '',
};

function normalizeKeyPart(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/:/g, '_') || 'unknown';
}

export function expiredPartyChecklistKey(item: Pick<ExpiredPartySourceItem, 'source' | 'serviceType' | 'accountEmail' | 'dealUsid'>): string {
  return [item.source, item.serviceType, item.accountEmail, item.dealUsid].map(normalizeKeyPart).join(':');
}

export function createDefaultExpiredPartyChecklistState(key: string): ExpiredPartyChecklistState {
  return {
    key,
    ...DEFAULT_STATE,
    updatedAt: '',
    updatedBy: '',
  };
}

function normalizeNullableBoolean(value: unknown): ChecklistAnswer | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (value === null) return null;
  return undefined;
}

export function mergeExpiredPartyChecklistState(
  store: ExpiredPartyChecklistStore,
  key: string,
  patch: Partial<ExpiredPartyChecklistState>,
  updatedBy = 'dashboard',
  now = new Date().toISOString(),
): ExpiredPartyChecklistStore {
  const current = store[key] || createDefaultExpiredPartyChecklistState(key);
  const next: ExpiredPartyChecklistState = { ...current, key };

  for (const field of ['recruitAgain', 'profileRemoved', 'devicesLoggedOut', 'passwordChanged', 'pinChanged', 'subscriptionCancelled'] as const) {
    const value = normalizeNullableBoolean(patch[field]);
    if (value !== undefined) next[field] = value;
  }
  if (typeof patch.note === 'string') next.note = patch.note.slice(0, 500);

  if (next.recruitAgain === true) {
    next.subscriptionCancelled = null;
  } else if (next.recruitAgain === false) {
    next.profileRemoved = null;
    next.devicesLoggedOut = null;
    next.passwordChanged = null;
    next.pinChanged = null;
  }

  next.updatedAt = now;
  next.updatedBy = updatedBy;
  return { ...store, [key]: next };
}

function buildProgress(state: ExpiredPartyChecklistState): { done: number; total: number } {
  let done = state.recruitAgain !== null ? 1 : 0;
  let total = 1;
  if (state.recruitAgain === true) {
    const required = [state.profileRemoved, state.devicesLoggedOut, state.passwordChanged, state.pinChanged];
    done += required.filter((value) => value === true).length;
    total += required.length;
  } else if (state.recruitAgain === false) {
    done += state.subscriptionCancelled !== null ? 1 : 0;
    total += 1;
  }
  return { done, total };
}

function nextActionFor(state: ExpiredPartyChecklistState): string {
  if (state.recruitAgain === null) return '재모집 여부 선택';
  if (state.recruitAgain === false) return state.subscriptionCancelled === true ? '해지 확인 완료' : '구독 해지 여부 확인';
  if (state.profileRemoved !== true) return '기존 파티원 프로필 제거';
  if (state.devicesLoggedOut !== true) return '모든 기기 로그아웃';
  if (state.passwordChanged !== true) return '비밀번호 변경';
  if (state.pinChanged !== true) return 'PIN 번호 변경';
  return '재모집 준비 완료';
}

export function buildExpiredPartyChecklistItems(
  items: ExpiredPartySourceItem[],
  store: ExpiredPartyChecklistStore = {},
): ExpiredPartyChecklistItem[] {
  return items.map((item) => {
    const key = expiredPartyChecklistKey(item);
    const state = store[key] || createDefaultExpiredPartyChecklistState(key);
    return {
      ...item,
      ...state,
      key,
      progress: buildProgress(state),
      nextAction: nextActionFor(state),
    };
  });
}
