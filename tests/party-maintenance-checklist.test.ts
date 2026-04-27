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
      pinChanged: null,
      subscriptionCancelled: null,
      progress: { done: 0, total: 1 },
      nextAction: '재모집 여부 선택',
    });
  });

  test('Y branch tracks account cleanup and clears subscription cancellation', () => {
    const key = partyMaintenanceChecklistKey(targets[0]);
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: true,
      profileRemoved: true,
      devicesLoggedOut: true,
      passwordChanged: false,
      pinChanged: true,
      subscriptionCancelled: true,
    }, 'tester');
    const [item] = buildPartyMaintenanceChecklistItems(targets, store);
    expect(item.subscriptionCancelled).toBeNull();
    expect(item.progress).toEqual({ done: 4, total: 5 });
  });

  test('N branch tracks subscription cancellation and clears account cleanup fields', () => {
    const key = partyMaintenanceChecklistKey(targets[0]);
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: false,
      profileRemoved: true,
      devicesLoggedOut: true,
      passwordChanged: true,
      pinChanged: true,
      subscriptionCancelled: false,
    }, 'tester');
    const [item] = buildPartyMaintenanceChecklistItems(targets, store);
    expect(item.profileRemoved).toBeNull();
    expect(item.devicesLoggedOut).toBeNull();
    expect(item.passwordChanged).toBeNull();
    expect(item.pinChanged).toBeNull();
    expect(item.progress).toEqual({ done: 2, total: 2 });
    expect(item.nextAction).toBe('구독 해지 여부 확인');
  });
});
