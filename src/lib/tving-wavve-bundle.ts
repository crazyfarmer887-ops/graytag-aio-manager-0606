export const DOUBLE_PASS_LABEL = '티빙+웨이브';
export const TVING_SERVICE = '티빙';
export const WAVVE_SERVICE = '웨이브';

export type DoublePassServiceType = typeof TVING_SERVICE | typeof WAVVE_SERVICE;
export type DoublePassBindingSource = 'auto-number' | 'manual-exception' | 'unpaired';

export interface DoublePassAccountLike {
  serviceType: string;
  email?: string;
  accountId?: string;
  loginId?: string;
  label?: string;
  generatedAccount?: { id?: string; emailId?: number | string };
  [key: string]: unknown;
}

export interface BoundAccountRef {
  serviceType: DoublePassServiceType;
  accountId: string;
  generatedAccountId?: string;
  emailId?: number | string;
  aliasLocalPart?: string;
}

export interface DoublePassBinding {
  bundleId: string;
  bundleNo: number;
  services: {
    tving?: BoundAccountRef;
    wavve?: BoundAccountRef;
  };
  source: DoublePassBindingSource;
}

const MANUAL_TVING_LOGIN_TO_WAVVE_BUNDLE: Record<string, number> = {
  gtwavve44: 5,
};

export function isDoublePassService(serviceType: string): boolean {
  const normalized = String(serviceType || '').trim();
  return normalized === TVING_SERVICE || normalized === WAVVE_SERVICE || normalized === DOUBLE_PASS_LABEL;
}

export function doublePassCanonicalService(serviceType: string): string {
  return isDoublePassService(serviceType) ? DOUBLE_PASS_LABEL : String(serviceType || '').trim();
}

function localPart(value: string): string {
  return String(value || '').trim().toLowerCase().split('@')[0] || '';
}

function accountIdentifier(ref: DoublePassAccountLike): string {
  return String(ref.loginId || ref.accountId || ref.email || ref.label || '').trim();
}

function aliasLocalPart(ref: DoublePassAccountLike): string | undefined {
  const id = accountIdentifier(ref);
  const local = localPart(id);
  return local || undefined;
}

function manualExceptionNo(ref: DoublePassAccountLike): number | null {
  const candidates = [ref.loginId, ref.accountId, ref.email, ref.label]
    .map(value => localPart(String(value || '')))
    .filter(Boolean);
  for (const candidate of candidates) {
    const mapped = MANUAL_TVING_LOGIN_TO_WAVVE_BUNDLE[candidate];
    if (mapped) return mapped;
  }
  return null;
}

export function extractAccountNumber(input: { serviceType?: string; email?: string; label?: string; loginId?: string; aliasLocalPart?: string; accountId?: string }): number | null {
  const candidates = [input.loginId, input.accountId, input.aliasLocalPart, input.email, input.label]
    .map(value => localPart(String(value || '')))
    .filter(Boolean);

  for (const candidate of candidates) {
    const explicit = candidate.match(/(?:gtwavve|wavve|tving|웨이브|티빙)(\d+)/i);
    if (explicit) return Number(explicit[1]);
  }

  for (const candidate of candidates) {
    const trailing = candidate.match(/(\d+)$/);
    if (trailing) return Number(trailing[1]);
  }

  return null;
}

export function resolveDoublePassBundleNo(ref: DoublePassAccountLike): number | null {
  if (!isDoublePassService(ref.serviceType)) return null;
  const manual = manualExceptionNo(ref);
  if (manual) return manual;
  return extractAccountNumber(ref);
}

function sourceForGroup(refs: DoublePassAccountLike[], hasTving: boolean, hasWavve: boolean): DoublePassBindingSource {
  if (refs.some(ref => manualExceptionNo(ref))) return 'manual-exception';
  if (hasTving && hasWavve) return 'auto-number';
  return 'unpaired';
}

function toBoundRef(ref: DoublePassAccountLike, serviceType: DoublePassServiceType): BoundAccountRef {
  return {
    serviceType,
    accountId: accountIdentifier(ref),
    generatedAccountId: ref.generatedAccount?.id,
    emailId: ref.generatedAccount?.emailId,
    aliasLocalPart: aliasLocalPart(ref),
  };
}

export function buildDoublePassBindings(accounts: DoublePassAccountLike[]): DoublePassBinding[] {
  const groups = new Map<number, DoublePassAccountLike[]>();
  for (const account of accounts) {
    if (!isDoublePassService(account.serviceType)) continue;
    const bundleNo = resolveDoublePassBundleNo(account);
    if (!bundleNo) continue;
    const group = groups.get(bundleNo) || [];
    group.push(account);
    groups.set(bundleNo, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([bundleNo, refs]) => {
      const tving = refs.find(ref => ref.serviceType === TVING_SERVICE);
      const wavve = refs.find(ref => ref.serviceType === WAVVE_SERVICE);
      return {
        bundleId: `double-pass:${bundleNo}`,
        bundleNo,
        services: {
          ...(tving ? { tving: toBoundRef(tving, TVING_SERVICE) } : {}),
          ...(wavve ? { wavve: toBoundRef(wavve, WAVVE_SERVICE) } : {}),
        },
        source: sourceForGroup(refs, Boolean(tving), Boolean(wavve)),
      };
    });
}

function accountWithBundle(account: any, binding: DoublePassBinding | undefined) {
  if (!binding) return account;
  return {
    ...account,
    doublePassBundle: {
      bundleId: binding.bundleId,
      bundleNo: binding.bundleNo,
      source: binding.source,
      hasTving: Boolean(binding.services.tving),
      hasWavve: Boolean(binding.services.wavve),
      tvingLoginId: binding.services.tving?.accountId,
      wavveAccountId: binding.services.wavve?.accountId,
    },
  };
}

export function mergeTvingWavveServicesForManagement<T extends { services: Array<any>; summary?: any }>(management: T): T {
  const doublePassAccounts = management.services
    .filter(service => isDoublePassService(service.serviceType))
    .flatMap(service => (service.accounts || []).map((account: any) => ({ ...account, serviceType: account.serviceType || service.serviceType })));
  if (doublePassAccounts.length === 0) return management;

  const bindings = buildDoublePassBindings(doublePassAccounts);
  const bindingByServiceAndId = new Map<string, DoublePassBinding>();
  for (const binding of bindings) {
    if (binding.services.tving) bindingByServiceAndId.set(`${TVING_SERVICE}:${binding.services.tving.accountId}`, binding);
    if (binding.services.wavve) bindingByServiceAndId.set(`${WAVVE_SERVICE}:${binding.services.wavve.accountId}`, binding);
  }

  const passthroughServices = management.services.filter(service => !isDoublePassService(service.serviceType));
  const bundledServices = management.services.filter(service => isDoublePassService(service.serviceType));
  const doublePassGroup = {
    serviceType: DOUBLE_PASS_LABEL,
    accounts: bundledServices.flatMap(service => (service.accounts || []).map((account: any) => {
      const accountId = accountIdentifier(account);
      const binding = bindingByServiceAndId.get(`${service.serviceType}:${accountId}`);
      return accountWithBundle({ ...account, serviceType: account.serviceType || service.serviceType }, binding);
    })),
    totalUsingMembers: bundledServices.reduce((sum, service) => sum + Number(service.totalUsingMembers || 0), 0),
    totalActiveMembers: bundledServices.reduce((sum, service) => sum + Number(service.totalActiveMembers || 0), 0),
    totalIncome: bundledServices.reduce((sum, service) => sum + Number(service.totalIncome || 0), 0),
    totalRealized: bundledServices.reduce((sum, service) => sum + Number(service.totalRealized || 0), 0),
  };

  return {
    ...management,
    services: [doublePassGroup, ...passthroughServices],
  };
}
