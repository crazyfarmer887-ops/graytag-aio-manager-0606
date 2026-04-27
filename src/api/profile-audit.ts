import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export * from '../lib/profile-audit';
import { type ProfileAuditStore } from '../lib/profile-audit';

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
