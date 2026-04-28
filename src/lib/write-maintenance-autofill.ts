import type { PartyMaintenanceChecklistStore } from './party-maintenance-checklist';

export interface WriteMaintenanceCredential {
  key: string;
  serviceType: string;
  accountEmail: string;
  password: string;
  pin: string;
  emailId: number | string;
  updatedAt: string;
}

function serviceAndEmailFromKey(key: string): { serviceType: string; accountEmail: string } {
  const index = key.indexOf(':');
  if (index < 0) return { serviceType: '', accountEmail: key };
  return { serviceType: key.slice(0, index), accountEmail: key.slice(index + 1) };
}

function isCompleteCredential(value: any): boolean {
  return value?.recruitAgain === true
    && value?.passwordChanged === true
    && typeof value?.changedPassword === 'string'
    && value.changedPassword.trim().length > 0
    && value?.pinStillUnchanged === false
    && typeof value?.generatedPin === 'string'
    && /^\d{6}$/.test(value.generatedPin.trim())
    && value?.generatedPinAliasId !== null
    && value?.generatedPinAliasId !== undefined;
}

export function findMaintenanceCredentialForAlias(
  store: PartyMaintenanceChecklistStore | null | undefined,
  aliasId: number | string | null | undefined,
): WriteMaintenanceCredential | null {
  if (!store || aliasId === null || aliasId === undefined) return null;
  const targetAliasId = String(aliasId);
  const matches = Object.entries(store)
    .filter(([, value]) => isCompleteCredential(value) && String(value.generatedPinAliasId) === targetAliasId)
    .sort(([, a], [, b]) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const [key, value] = matches[0] || [];
  if (!key || !value) return null;
  const parsed = serviceAndEmailFromKey(key);
  return {
    key,
    serviceType: parsed.serviceType,
    accountEmail: parsed.accountEmail,
    password: value.changedPassword.trim(),
    pin: value.generatedPin.trim(),
    emailId: value.generatedPinAliasId!,
    updatedAt: value.updatedAt || value.generatedPinAt || '',
  };
}
