import { describe, expect, test } from 'vitest';
import { buildExpiredPartyChecklistItems, expiredPartyChecklistKey, mergeExpiredPartyChecklistState } from '../src/lib/expired-party-checklist';

const expiredParties = [
  {
    dealUsid: 'deal-1',
    serviceType: '넷플릭스',
    accountEmail: 'netflix@example.com',
    memberName: '만료회원',
    status: 'NormalFinished',
    statusName: '거래완료',
    endDate: '2026-04-26',
    price: '1,000원',
    source: 'graytag' as const,
  },
  {
    dealUsid: 'deal-2',
    serviceType: '티빙',
    accountEmail: 'tving@example.com',
    memberName: '예전회원',
    status: 'expired',
    statusName: '수동 만료',
    endDate: '2026-04-20',
    price: '5,000원',
    source: 'manual' as const,
  },
];

describe('expired party checklist', () => {
  test('creates stable checklist keys and default Y/N workflow state', () => {
    const items = buildExpiredPartyChecklistItems(expiredParties, {});
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: 'graytag:넷플릭스:netflix@example.com:deal-1',
      recruitAgain: null,
      profileRemoved: null,
      devicesLoggedOut: null,
      passwordChanged: null,
      pinChanged: null,
      subscriptionCancelled: null,
      progress: { done: 0, total: 1 },
    });
  });

  test('tracks recruit-again checklist separately from subscription-cancel checklist', () => {
    const key = expiredPartyChecklistKey(expiredParties[0]);
    const store = mergeExpiredPartyChecklistState({}, key, {
      recruitAgain: true,
      profileRemoved: true,
      devicesLoggedOut: true,
      passwordChanged: false,
      pinChanged: true,
    }, 'tester');
    const [item] = buildExpiredPartyChecklistItems(expiredParties.slice(0, 1), store);
    expect(item.progress).toEqual({ done: 4, total: 5 });
    expect(item.subscriptionCancelled).toBeNull();

    const noStore = mergeExpiredPartyChecklistState(store, key, {
      recruitAgain: false,
      subscriptionCancelled: true,
    }, 'tester');
    const [noItem] = buildExpiredPartyChecklistItems(expiredParties.slice(0, 1), noStore);
    expect(noItem.progress).toEqual({ done: 2, total: 2 });
    expect(noItem.profileRemoved).toBeNull();
    expect(noItem.subscriptionCancelled).toBe(true);
  });
});
