import { describe, expect, test } from 'vitest';
import { buildPartyMaintenanceChecklistItems, generateMaintenancePassword, mergePartyMaintenanceChecklistState, partyMaintenanceChecklistKey, splitPartyMaintenanceChecklistItems } from '../src/lib/party-maintenance-checklist';

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
  test('generates a 12 character password that starts lowercase and mixes digits with !/@ symbols', () => {
    const values = [0.0, 0.1, 0.5, 0.9, 0.2, 0.7, 0.3, 0.8, 0.4, 0.6, 0.11, 0.91, 0.21, 0.71, 0.31, 0.81];
    let i = 0;
    const password = generateMaintenancePassword(() => values[i++ % values.length]);
    expect(password).toHaveLength(12);
    expect(password).toMatch(/^[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@]/);
    expect(password).toMatch(/^[a-z][a-z0-9!@]{11}$/);
  });

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
      partyRestarted: null,
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
    expect(item.nextAction).toBe('파티 재시작 여부 확인');
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

  test('keeps recruit-again YES items active until party restart is confirmed', () => {
    const key = partyMaintenanceChecklistKey(targets[0]);
    const recruitingStore = mergePartyMaintenanceChecklistState({}, key, { recruitAgain: true }, 'tester');
    const recruitingItems = buildPartyMaintenanceChecklistItems(targets, recruitingStore);
    const recruitingSplit = splitPartyMaintenanceChecklistItems(recruitingItems);
    expect(recruitingSplit.active).toHaveLength(1);
    expect(recruitingSplit.completed).toHaveLength(0);

    const restartedStore = mergePartyMaintenanceChecklistState(recruitingStore, key, { partyRestarted: true }, 'tester');
    const restartedItems = buildPartyMaintenanceChecklistItems(targets, restartedStore);
    const restartedSplit = splitPartyMaintenanceChecklistItems(restartedItems);
    expect(restartedSplit.active).toHaveLength(0);
    expect(restartedSplit.completed).toHaveLength(1);
    expect(restartedSplit.completed[0].key).toBe(key);
  });
});
