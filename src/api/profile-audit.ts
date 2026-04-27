import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export * from '../lib/profile-audit';
import { type ProfileAuditStore } from '../lib/profile-audit';

export type ProfileAuditProgressStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ProfileAuditProgress {
  status: ProfileAuditProgressStatus;
  total: number;
  completed: number;
  percent: number;
  currentServiceType: string | null;
  currentAccountEmail: string | null;
  message: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

const DEFAULT_PROFILE_AUDIT_STORE = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/profile-audit-results.json';

export function profileAuditStorePath() {
  return process.env.PROFILE_AUDIT_STORE_PATH || DEFAULT_PROFILE_AUDIT_STORE;
}

export function loadProfileAuditStore(path = profileAuditStorePath()): ProfileAuditStore {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveProfileAuditStore(store: ProfileAuditStore, path = profileAuditStorePath()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

function boundedPercent(completed: number, total: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

export function createProfileAuditProgress(total: number): ProfileAuditProgress {
  const now = new Date().toISOString();
  return {
    status: 'running',
    total: Math.max(0, total),
    completed: 0,
    percent: total <= 0 ? 100 : 0,
    currentServiceType: null,
    currentAccountEmail: null,
    message: total > 0 ? '프로필 검증을 시작했어요.' : '검증할 계정이 없어요.',
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
}

export function updateProfileAuditProgress(progress: ProfileAuditProgress, patch: Partial<Pick<ProfileAuditProgress, 'completed' | 'currentServiceType' | 'currentAccountEmail' | 'message'>>): ProfileAuditProgress {
  if (typeof patch.completed === 'number') progress.completed = Math.max(0, Math.min(progress.total, patch.completed));
  if (patch.currentServiceType !== undefined) progress.currentServiceType = patch.currentServiceType;
  if (patch.currentAccountEmail !== undefined) progress.currentAccountEmail = patch.currentAccountEmail;
  if (patch.message !== undefined) progress.message = patch.message;
  progress.percent = boundedPercent(progress.completed, progress.total);
  progress.updatedAt = new Date().toISOString();
  return progress;
}

export function finishProfileAuditProgress(progress: ProfileAuditProgress, status: Exclude<ProfileAuditProgressStatus, 'idle' | 'running'>, message?: string): ProfileAuditProgress {
  progress.status = status;
  if (status === 'completed') progress.completed = progress.total;
  progress.percent = boundedPercent(progress.completed, progress.total);
  progress.message = message || (status === 'completed' ? '프로필 검증이 완료됐어요.' : '프로필 검증 중 오류가 발생했어요.');
  progress.currentServiceType = null;
  progress.currentAccountEmail = null;
  progress.updatedAt = new Date().toISOString();
  progress.finishedAt = progress.updatedAt;
  return progress;
}
