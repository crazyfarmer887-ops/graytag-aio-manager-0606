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

export function nextGeneratedAliasPrefix(serviceType: string, existingEmails: string[]): string {
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
