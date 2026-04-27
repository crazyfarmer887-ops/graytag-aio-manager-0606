import { describe, expect, test } from 'vitest';
import { buildPartyMaintenanceChecklistItems, mergePartyMaintenanceChecklistState, partyMaintenanceChecklistKey } from '../src/lib/party-maintenance-checklist';

const targets = [
  {
    key: '넷플릭스:empty@example.com',
    serviceType: '넷플릭스',
    accountEmail: 'empty@example.com',
    reason: 'no-current-users' as const,
    reasonLabel: '이용중 0명',
    usingCount: 0,
    activeCount: 0,
    totalSlots: 5,
    expiryDate: '2026-04-20',
    daysUntilExpiry: -8,
    lastMemberName: 'Old',
    memberCount: 1,
  },
];

describe('party maintenance checklist', () => {
  test('creates stable account-level keys and default Y/N state', () => {
    expect(partyMaintenanceChecklistKey(targets[0])).toBe('넷플릭스:empty@example.com');
    const [item] = buildPartyMaintenanceChecklistItems(targets, {});
    expect(item).toMatchObject({
      key: '넷플릭스:empty@example.com',
      recruitAgain: null,
      profileRemoved: null,
      devicesLoggedOut: null,
      passwordChanged: null,
      changedPassword: '',
      pinStillUnchanged: null,
      generatedPin: '',
      subscriptionKept: null,
      subscriptionBillingDay: '',
      subscriptionCancelled: null,
      progress: { done: 0, total: 1 },
      nextAction: '재모집 여부 선택',
    });
  });

  test('Y branch stores billing day, changed password, and PIN regeneration fields', () => {
    const key = partyMaintenanceChecklistKey(targets[0]);
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: true,
      subscriptionKept: true,
      subscriptionBillingDay: '15일',
      profileRemoved: true,
      devicesLoggedOut: true,
      passwordChanged: true,
      changedPassword: 'new-password-123',
      pinStillUnchanged: false,
      generatedPin: '123456',
      generatedPinAliasId: 777,
      subscriptionCancelled: true,
    }, 'tester');
    const [item] = buildPartyMaintenanceChecklistItems(targets, store);
    expect(item.subscriptionCancelled).toBeNull();
    expect(item.subscriptionBillingDay).toBe('15');
    expect(item.changedPassword).toBe('new-password-123');
    expect(item.pinStillUnchanged).toBe(false);
    expect(item.generatedPin).toBe('123456');
    expect(item.generatedPinAliasId).toBe(777);
    expect(item.progress).toEqual({ done: 9, total: 9 });
    expect(item.nextAction).toBe('재모집 준비 완료');
  });

  test('Y branch requires billing day and changed password when their Y answers are selected', () => {
    const key = partyMaintenanceChecklistKey(targets[0]);
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: true,
      subscriptionKept: true,
      subscriptionBillingDay: '45',
      passwordChanged: true,
      changedPassword: '',
      pinStillUnchanged: true,
    }, 'tester');
    const [item] = buildPartyMaintenanceChecklistItems(targets, store);
    expect(item.subscriptionBillingDay).toBe('');
    expect(item.progress).toEqual({ done: 4, total: 9 });
    expect(item.nextAction).toBe('구독 결제일 입력');
  });

  test('N branch tracks subscription cancellation and clears Y-branch-only fields', () => {
    const key = partyMaintenanceChecklistKey(targets[0]);
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: false,
      profileRemoved: true,
      devicesLoggedOut: true,
      passwordChanged: true,
      changedPassword: 'stale-password',
      pinStillUnchanged: false,
      generatedPin: '654321',
      subscriptionKept: true,
      subscriptionBillingDay: '15',
      subscriptionCancelled: false,
    }, 'tester');
    const [item] = buildPartyMaintenanceChecklistItems(targets, store);
    expect(item.profileRemoved).toBeNull();
    expect(item.devicesLoggedOut).toBeNull();
    expect(item.passwordChanged).toBeNull();
    expect(item.changedPassword).toBe('');
    expect(item.pinStillUnchanged).toBeNull();
    expect(item.generatedPin).toBe('');
    expect(item.subscriptionKept).toBeNull();
    expect(item.subscriptionBillingDay).toBe('');
    expect(item.progress).toEqual({ done: 2, total: 2 });
    expect(item.nextAction).toBe('구독 해지 여부 확인');
  });
});
