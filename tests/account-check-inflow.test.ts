import { describe, expect, test } from 'vitest';
import { buildAccountCheckInflowStore, type AccountCheckDealLike } from '../src/lib/account-check-inflow';

const checkingDeal = (overrides: Partial<AccountCheckDealLike> = {}): AccountCheckDealLike => ({
  dealUsid: 'deal-1',
  dealStatus: 'Delivered',
  lenderDealStatusName: '계정확인중',
  productTypeString: '넷플릭스',
  borrowerName: 'buyer',
  ...overrides,
});

describe('account check inflow tracking', () => {
  test('records first account-check date, preserves it after using, and removes it on cancellation', () => {
    const first = buildAccountCheckInflowStore([checkingDeal()], {}, { now: '2026-05-01T10:15:00.000Z' });
    expect(first.store['deal-1']).toMatchObject({ firstSeenDate: '2026-05-01', statusName: '계정확인중' });
    expect(first.inflowDateByDealUsid['deal-1']).toBe('2026-05-01');

    const using = buildAccountCheckInflowStore([
      checkingDeal({ dealStatus: 'Using', lenderDealStatusName: '사용중', startDateTime: '2026-05-03T00:00:00' }),
    ], first.store, { now: '2026-05-03T09:00:00.000Z' });
    expect(using.store['deal-1'].firstSeenDate).toBe('2026-05-01');
    expect(using.inflowDateByDealUsid['deal-1']).toBe('2026-05-01');

    const cancelled = buildAccountCheckInflowStore([
      checkingDeal({ dealStatus: 'CancelByDepositRejection', lenderDealStatusName: '거래취소' }),
    ], using.store, { now: '2026-05-04T09:00:00.000Z' });
    expect(cancelled.store['deal-1']).toBeUndefined();
    expect(cancelled.inflowDateByDealUsid['deal-1']).toBeUndefined();
  });
});
