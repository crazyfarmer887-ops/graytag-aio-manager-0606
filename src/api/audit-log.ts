import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type AuditActor = 'admin' | 'scheduler' | 'system';
export type AuditResult = 'success' | 'blocked' | 'error';

export interface AuditLogEntry {
  timestamp: string;
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  result: AuditResult;
  requestId: string;
  before?: unknown;
  after?: unknown;
  details?: unknown;
}

export type NewAuditLogEntry = Omit<AuditLogEntry, 'timestamp'> & { timestamp?: string };

const DEFAULT_AUDIT_LOG_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/audit-log.jsonl';
const SENSITIVE_KEY_RE = /^(authorization|cookie|set-cookie|jsessionid|awsalb|awsalbcors|pin|password|passwd|keepPasswd|token|accessToken|refreshToken|oauth|oauthToken|clientSecret|secret)$/i;
const SENSITIVE_SUBKEY_RE = /(authorization|cookie|jsessionid|awsalb|awsalbcors|pin|password|passwd|token|oauth|secret)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[^\s,;]+/gi,
  /JSESSIONID=([^;\s]+)/gi,
  /AWSALB(?:CORS)?=([^;\s]+)/gi,
  /(authorization\s*[:=]\s*)([^\s,;]+)/gi,
];

function auditLogPath(): string {
  return process.env.AUDIT_LOG_PATH || DEFAULT_AUDIT_LOG_PATH;
}

function maskString(value: string): string {
  let masked = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    masked = masked.replace(pattern, (match, prefix) => {
      if (match.toLowerCase().startsWith('bearer ')) return 'Bearer [MASKED]';
      if (match.includes('=')) return match.replace(/=.*/, '=[MASKED]');
      return `${prefix}[MASKED]`;
    });
  }
  return masked;
}

export function maskSensitive<T>(value: T, keyHint = ''): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_RE.test(keyHint) || SENSITIVE_SUBKEY_RE.test(keyHint)) return '[MASKED]' as T;
    return maskString(value) as T;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (SENSITIVE_KEY_RE.test(keyHint) || SENSITIVE_SUBKEY_RE.test(keyHint)) return '[MASKED]' as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item, keyHint)) as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key) || SENSITIVE_SUBKEY_RE.test(key)
        ? '[MASKED]'
        : maskSensitive(child, key);
    }
    return out as T;
  }
  return value;
}

export function appendAuditLog(entry: NewAuditLogEntry): AuditLogEntry {
  const path = auditLogPath();
  mkdirSync(dirname(path), { recursive: true });
  const complete: AuditLogEntry = maskSensitive({
    timestamp: entry.timestamp || new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    targetType: entry.targetType,
    targetId: String(entry.targetId ?? ''),
    summary: entry.summary,
    result: entry.result,
    requestId: entry.requestId,
    ...(entry.before !== undefined ? { before: entry.before } : {}),
    ...(entry.after !== undefined ? { after: entry.after } : {}),
    ...(entry.details !== undefined ? { details: entry.details } : {}),
  });
  appendFileSync(path, `${JSON.stringify(complete)}\n`, 'utf8');
  return complete;
}

export function readAuditLog(options: { limit?: number } = {}): AuditLogEntry[] {
  const path = auditLogPath();
  const requested = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50;
  const limit = Math.max(1, Math.min(200, requested));
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const entries: AuditLogEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      entries.push(maskSensitive(JSON.parse(lines[i])) as AuditLogEntry);
    } catch {
      // Ignore corrupt partial lines; append-only logs should keep serving valid entries.
    }
  }
  return entries;
}

export function auditRequestId(c: any): string {
  return c?.req?.header?.('x-request-id') || c?.req?.header?.('cf-ray') || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
