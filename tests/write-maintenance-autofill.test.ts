import { describe, expect, test } from 'vitest';
import { findMaintenanceCredentialForAlias } from '../src/lib/write-maintenance-autofill';
import type { PartyMaintenanceChecklistStore } from '../src/lib/party-maintenance-checklist';

describe('write maintenance credential autofill', () => {
  test('loads saved account password and verified PIN by selected email alias id', () => {
    const store: PartyMaintenanceChecklistStore = {
      '넷플릭스:ott@example.com': {
        key: '넷플릭스:ott@example.com',
        recruitAgain: true,
        subscriptionKept: true,
        subscriptionBillingDay: '15',
        profileRemoved: true,
        devicesLoggedOut: true,
        passwordChanged: true,
        changedPassword: 'a1234!bcd@ef',
        pinStillUnchanged: false,
        generatedPin: '987654',
        generatedPinAliasId: 40563918,
        generatedPinAt: '2026-04-28T00:00:00.000Z',
        subscriptionCancelled: null,
        note: '',
        updatedAt: '2026-04-28T00:00:00.000Z',
        updatedBy: 'dashboard',
      },
    };

    const result = findMaintenanceCredentialForAlias(store, 40563918);

    expect(result).toMatchObject({
      key: '넷플릭스:ott@example.com',
      accountEmail: 'ott@example.com',
      password: 'a1234!bcd@ef',
      pin: '987654',
      emailId: 40563918,
    });
  });

  test('does not use incomplete or stale maintenance rows', () => {
    const store: PartyMaintenanceChecklistStore = {
      '넷플릭스:missing-password@example.com': {
        key: '넷플릭스:missing-password@example.com',
        recruitAgain: true,
        subscriptionKept: true,
        subscriptionBillingDay: '15',
        profileRemoved: true,
        devicesLoggedOut: true,
        passwordChanged: false,
        changedPassword: 'stale-password',
        pinStillUnchanged: false,
        generatedPin: '123456',
        generatedPinAliasId: 1,
        generatedPinAt: '',
        subscriptionCancelled: null,
        note: '',
        updatedAt: '',
        updatedBy: '',
      },
      '넷플릭스:missing-pin@example.com': {
        key: '넷플릭스:missing-pin@example.com',
        recruitAgain: true,
        subscriptionKept: true,
        subscriptionBillingDay: '15',
        profileRemoved: true,
        devicesLoggedOut: true,
        passwordChanged: true,
        changedPassword: 'a1234!bcd@ef',
        pinStillUnchanged: true,
        generatedPin: '',
        generatedPinAliasId: 2,
        generatedPinAt: '',
        subscriptionCancelled: null,
        note: '',
        updatedAt: '',
        updatedBy: '',
      },
    };

    expect(findMaintenanceCredentialForAlias(store, 1)).toBeNull();
    expect(findMaintenanceCredentialForAlias(store, 2)).toBeNull();
    expect(findMaintenanceCredentialForAlias(store, 999)).toBeNull();
  });
});
