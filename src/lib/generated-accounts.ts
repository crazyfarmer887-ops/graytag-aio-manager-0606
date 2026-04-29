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

export type GeneratedAccountStore = Record<string, GeneratedAccount>;

export function normalizeGeneratedAccountEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function generatedAccountKey(serviceType: string, email: string): string {
  return `${String(serviceType || '').trim()}:${normalizeGeneratedAccountEmail(email)}`;
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
