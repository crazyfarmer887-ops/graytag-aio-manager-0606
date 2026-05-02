export type GeneratedAccountPaymentStatus = 'pending' | 'paid';

export interface GeneratedAccount {
  id: string;
  serviceType: string;
  email: string;
  password: string;
  pin: string;
  emailId: number | string;
  memo: string;
  createdAt: string;
  paymentStatus: GeneratedAccountPaymentStatus;
  paidAt: string | null;
  source: 'account-generator';
}

export interface SimpleLoginAliasRef {
  id?: number | string;
  email: string;
}

export type GeneratedAccountStore = Record<string, GeneratedAccount>;

export function extractSimpleLoginAliasRef(data: any): SimpleLoginAliasRef | null {
  const candidate = data?.alias ?? data?.data?.alias ?? data;
  if (typeof candidate === 'string') {
    const email = normalizeGeneratedAccountEmail(candidate);
    return email.includes('@') ? { email } : null;
  }
  if (!candidate || typeof candidate !== 'object') return null;

  const rawEmail = candidate.email
    ?? candidate.address
    ?? candidate.mailbox
    ?? candidate.alias
    ?? data?.email
    ?? data?.address;
  const email = normalizeGeneratedAccountEmail(String(rawEmail || ''));
  if (!email.includes('@')) return null;

  const id = candidate.id
    ?? candidate.alias_id
    ?? candidate.aliasId
    ?? data?.id
    ?? data?.alias_id
    ?? data?.aliasId;
  return id === undefined || id === null || id === '' ? { email } : { id, email };
}

export function normalizeGeneratedAccountEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function generatedAccountKey(serviceType: string, email: string): string {
  return `${String(serviceType || '').trim()}:${normalizeGeneratedAccountEmail(email)}`;
}

const SERVICE_ALIAS_STEMS: Record<string, string> = {
  '넷플릭스': 'netflix',
  '디즈니플러스': 'disney',
  '유튜브': 'youtube',
  '왓챠플레이': 'watcha',
  '웨이브': 'wavve',
  '티빙+웨이브': 'gtwavve',
  '라프텔': 'laftel',
  '티빙': 'tving',
  '쿠팡플레이': 'coupang',
  'AppleOne': 'apple',
  '프라임비디오': 'prime',
};

export function serviceAliasStem(serviceType: string): string {
  const trimmed = String(serviceType || '').trim();
  const mapped = SERVICE_ALIAS_STEMS[trimmed];
  if (mapped) return mapped;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized || 'ott';
}

export interface GeneratedAccountCreationCopy {
  serviceLabel: string;
  description: string;
  prefixLabel: string;
  prefixPlaceholder: string;
  prefixHelp: string;
  featureLabels: string[];
}

export function getGeneratedAccountCreationCopy(serviceType: string): GeneratedAccountCreationCopy {
  const normalized = String(serviceType || '').trim();
  if (normalized === '티빙+웨이브') {
    return {
      serviceLabel: '티빙+웨이브 더블 플랜',
      description: '웨이브 19,500원 더블 플랜 결제 후 티빙을 바인딩하는 계정 묶음이에요. 티빙은 이메일 로그인이 안 되므로 gtwavveN ID를 기준으로 맞춰요.',
      prefixLabel: '더블플랜 번호 / 티빙 로그인 ID',
      prefixPlaceholder: '예: gtwavve7, gtwavve44',
      prefixHelp: '티빙 로그인 ID는 gtwavveN으로 만들고, 웨이브 로그인은 같은 prefix의 Email alias로 생성해요. 비워두면 기존 gtwavve 번호 다음 번호를 자동 생성합니다.',
      featureLabels: ['웨이브 Email alias 생성', '티빙 ID gtwavveN 기준', '비밀번호·PIN 자동 생성', '더블이용권 묶음 관리'],
    };
  }

  const label = normalized || 'OTT';
  return {
    serviceLabel: label,
    description: 'Email 대시보드 alias + 비밀번호 + 6자리 PIN을 새로 만들고, 판매 게시물 없이도 계정 관리에 바로 유지해요.',
    prefixLabel: 'alias prefix 직접 설정',
    prefixPlaceholder: '예: wavve7, netflix12',
    prefixHelp: '비워두면 서비스별 다음 번호를 자동 생성해요. 입력하면 해당 prefix로 SimpleLogin alias를 만들고 계정 관리에 바로 표시됩니다.',
    featureLabels: ['이메일 자동 생성', '비밀번호 자동 생성', 'PIN 자동 생성', '계정 관리 표시'],
  };
}

export function normalizeManualAliasPrefix(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('@')) throw new Error('prefix에는 @ 포함 이메일 전체를 넣지 말고 앞부분만 입력하세요.');
  if (/[^a-z0-9_-]/i.test(raw)) throw new Error('prefix는 영문/숫자만 입력하세요.');
  const normalized = raw.replace(/[^a-z0-9]/g, '');
  if (!/[a-z]/.test(normalized)) throw new Error('prefix에는 영문이 1자 이상 필요합니다.');
  if (normalized.length < 3) throw new Error('prefix는 3자 이상이어야 합니다.');
  if (normalized.length > 32) throw new Error('prefix는 32자 이하여야 합니다.');
  return normalized;
}

export function nextGeneratedAliasPrefix(serviceType: string, existingEmails: string[], manualPrefix = ''): string {
  const normalizedManual = normalizeManualAliasPrefix(manualPrefix);
  if (normalizedManual) return normalizedManual;
  const stem = serviceAliasStem(serviceType);
  const pattern = new RegExp(`^${stem}(\\d+)(?:[.@]|$)`, 'i');
  let max = 0;
  for (const email of existingEmails) {
    const local = normalizeGeneratedAccountEmail(email).split('@')[0] || '';
    const match = local.match(pattern);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isFinite(number) && number > max) max = number;
  }
  return `${stem}${max + 1}`;
}

export function deleteGeneratedAccountFromStore(store: GeneratedAccountStore, id: string): { store: GeneratedAccountStore; deleted: GeneratedAccount | null } {
  const deleted = store[id] || null;
  if (!deleted) return { store, deleted: null };
  const next = { ...store };
  delete next[id];
  return { store: next, deleted };
}

export function generateAccountPassword(random = Math.random): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@';
  const pool = `${lower}${digits}${symbols}`;
  const pick = (chars: string) => chars[Math.floor(random() * chars.length)] || chars[0];
  const chars = [pick(lower)];
  for (let i = 1; i < 10; i += 1) chars.push(pick(pool));
  if (!chars.some(c => digits.includes(c))) chars[5] = pick(digits);
  if (!chars.some(c => symbols.includes(c))) chars[9] = pick(symbols);
  return chars.join('');
}

export function normalizeGeneratedAccountPatch(input: Partial<GeneratedAccount>) {
  const patch: Partial<GeneratedAccount> = {};
  if (input.paymentStatus === 'paid' || input.paymentStatus === 'pending') {
    patch.paymentStatus = input.paymentStatus;
    patch.paidAt = input.paymentStatus === 'paid' ? (input.paidAt || new Date().toISOString()) : null;
  }
  return patch;
}

export function buildGeneratedAccount(input: {
  serviceType: string;
  alias: { id: number | string; email: string };
  password: string;
  pin: string;
  memo: string;
  now?: string;
}): GeneratedAccount {
  const serviceType = String(input.serviceType || '').trim();
  const email = normalizeGeneratedAccountEmail(input.alias.email);
  const createdAt = input.now || new Date().toISOString();
  return {
    id: `${Date.parse(createdAt) || Date.now()}-${String(input.alias.id)}`,
    serviceType,
    email,
    password: input.password,
    pin: input.pin,
    emailId: input.alias.id,
    memo: input.memo,
    createdAt,
    paymentStatus: 'pending',
    paidAt: null,
    source: 'account-generator',
  };
}

export function generatedAccountToManagementAccount(account: GeneratedAccount) {
  return {
    email: account.email,
    serviceType: account.serviceType,
    members: [],
    usingCount: 0,
    activeCount: 0,
    totalSlots: 6,
    totalIncome: 0,
    totalRealizedIncome: 0,
    expiryDate: null,
    keepPasswd: account.password,
    generatedAccount: {
      id: account.id,
      createdAt: account.createdAt,
      paymentStatus: account.paymentStatus,
      paidAt: account.paidAt,
      emailId: account.emailId,
      pin: account.pin,
      memo: account.memo,
    },
  };
}

export function mergeGeneratedAccountsIntoManagement<T extends {
  services: Array<{ serviceType: string; accounts: any[]; totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number }>;
  summary: { totalAccounts: number; [key: string]: unknown };
}>(management: T, store: GeneratedAccountStore): T {
  const next: T = {
    ...management,
    services: management.services.map(service => ({ ...service, accounts: [...service.accounts] })),
    summary: { ...management.summary },
  };
  const existing = new Set<string>();
  for (const service of next.services) {
    for (const account of service.accounts) {
      existing.add(generatedAccountKey(account.serviceType || service.serviceType, account.email));
    }
  }

  let added = 0;
  const generated = Object.values(store).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const account of generated) {
    const key = generatedAccountKey(account.serviceType, account.email);
    if (existing.has(key)) continue;
    let service = next.services.find(s => s.serviceType === account.serviceType);
    if (!service) {
      service = { serviceType: account.serviceType, accounts: [], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 };
      next.services.push(service);
    }
    service.accounts.unshift(generatedAccountToManagementAccount(account));
    existing.add(key);
    added += 1;
  }

  next.summary.totalAccounts = Number(next.summary.totalAccounts || 0) + added;
  return next;
}
