export type MaintenanceChecklistAnswer = boolean | null;

export interface PartyMaintenanceTargetLike {
  key: string;
  serviceType: string;
  accountEmail: string;
}

export interface PartyMaintenanceChecklistState {
  key: string;
  recruitAgain: MaintenanceChecklistAnswer;
  profileRemoved: MaintenanceChecklistAnswer;
  devicesLoggedOut: MaintenanceChecklistAnswer;
  passwordChanged: MaintenanceChecklistAnswer;
  pinChanged: MaintenanceChecklistAnswer;
  subscriptionKept: MaintenanceChecklistAnswer;
  subscriptionPeriod: string;
  subscriptionCancelled: MaintenanceChecklistAnswer;
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
  pinChanged: null,
  subscriptionKept: null,
  subscriptionPeriod: '',
  subscriptionCancelled: null,
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

export function mergePartyMaintenanceChecklistState(
  store: PartyMaintenanceChecklistStore,
  key: string,
  patch: Partial<PartyMaintenanceChecklistState>,
  updatedBy = 'dashboard',
  now = new Date().toISOString(),
): PartyMaintenanceChecklistStore {
  const current = store[key] || createDefaultPartyMaintenanceChecklistState(key);
  const next: PartyMaintenanceChecklistState = { ...current, key };
  for (const field of ['recruitAgain', 'profileRemoved', 'devicesLoggedOut', 'passwordChanged', 'pinChanged', 'subscriptionKept', 'subscriptionCancelled'] as const) {
    const value = normalizeNullableBoolean(patch[field]);
    if (value !== undefined) next[field] = value;
  }
  if (typeof patch.subscriptionPeriod === 'string') next.subscriptionPeriod = patch.subscriptionPeriod.slice(0, 100);
  if (typeof patch.note === 'string') next.note = patch.note.slice(0, 500);

  if (next.recruitAgain === true) {
    next.subscriptionCancelled = null;
    if (next.subscriptionKept !== true) next.subscriptionPeriod = '';
  } else if (next.recruitAgain === false) {
    next.profileRemoved = null;
    next.devicesLoggedOut = null;
    next.passwordChanged = null;
    next.pinChanged = null;
    next.subscriptionKept = null;
    next.subscriptionPeriod = '';
  }

  next.updatedAt = now;
  next.updatedBy = updatedBy;
  return { ...store, [key]: next };
}

function buildProgress(state: PartyMaintenanceChecklistState): { done: number; total: number } {
  let done = state.recruitAgain !== null ? 1 : 0;
  let total = 1;
  if (state.recruitAgain === true) {
    const required = [state.subscriptionKept, state.profileRemoved, state.devicesLoggedOut, state.passwordChanged, state.pinChanged];
    done += required.filter((value) => value === true).length;
    total += required.length;
    if (state.subscriptionKept === true) {
      total += 1;
      if (state.subscriptionPeriod.trim()) done += 1;
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
  if (state.subscriptionKept === true && !state.subscriptionPeriod.trim()) return '구독 기간 입력';
  if (state.profileRemoved !== true) return '기존 파티원 프로필 제거';
  if (state.devicesLoggedOut !== true) return '모든 기기 로그아웃';
  if (state.passwordChanged !== true) return '비밀번호 변경';
  if (state.pinChanged !== true) return 'PIN 번호 변경';
  return '재모집 준비 완료';
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
