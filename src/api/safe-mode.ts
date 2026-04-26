import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SafeModeConfig {
  enabled: boolean;
  reason: string;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_SAFE_MODE_CONFIG: SafeModeConfig = {
  enabled: false,
  reason: '',
  updatedAt: '',
  updatedBy: 'system',
};

const DEFAULT_SAFE_MODE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';

function safeModePath(): string {
  return process.env.SAFE_MODE_PATH || DEFAULT_SAFE_MODE_PATH;
}

function normalizeSafeModeConfig(input: Partial<SafeModeConfig> = {}, fallback: SafeModeConfig = DEFAULT_SAFE_MODE_CONFIG): SafeModeConfig {
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 500) : fallback.reason,
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : fallback.updatedAt,
    updatedBy: typeof input.updatedBy === 'string' && input.updatedBy.trim() ? input.updatedBy.trim().slice(0, 120) : fallback.updatedBy,
  };
}

export function loadSafeModeConfig(): SafeModeConfig {
  const path = safeModePath();
  if (!existsSync(path)) return { ...DEFAULT_SAFE_MODE_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SafeModeConfig>;
    return normalizeSafeModeConfig(parsed);
  } catch {
    return { ...DEFAULT_SAFE_MODE_CONFIG };
  }
}

export function saveSafeModeConfig(update: Partial<SafeModeConfig>): SafeModeConfig {
  const before = loadSafeModeConfig();
  const next: SafeModeConfig = normalizeSafeModeConfig(
    {
      ...before,
      ...update,
      enabled: typeof update.enabled === 'boolean' ? update.enabled : before.enabled,
      updatedAt: new Date().toISOString(),
    },
    before,
  );
  const path = safeModePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
