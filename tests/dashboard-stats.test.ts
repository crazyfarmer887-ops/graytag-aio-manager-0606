import { describe, expect, test } from 'vitest';
import { buildExpiredPartyItems, buildServiceStats } from '../src/web/lib/dashboard-stats';

const data = {
  services: [
    {
      serviceType: '넷플릭스',
      totalUsingMembers: 2,
      totalActiveMembers: 4,
      totalIncome: 10000,
      totalRealized: 5000,
      accounts: [
        {
          email: 'netflix@example.com',
          serviceType: '넷플릭스',
          usingCount: 2,
          activeCount: 3,
          totalSlots: 9,
          totalIncome: 10000,
          totalRealizedIncome: 5000,
          expiryDate: '2026-07-01',
          members: [
            { dealUsid: 'using-1', name: 'A', status: 'Using', statusName: '사용중', price: '1,000원', purePrice: 1000, realizedSum: 0, progressRatio: '50%', startDateTime: '26. 06. 01', endDateTime: '26. 07. 01', remainderDays: 10, source: 'after' },
            { dealUsid: 'using-2', name: 'B', status: 'UsingNearExpiration', statusName: '종료임박', price: '1,000원', purePrice: 1000, realizedSum: 0, progressRatio: '90%', startDateTime: '26. 06. 01', endDateTime: '26. 07. 01', remainderDays: 1, source: 'after' },
            { dealUsid: 'expired-1', name: 'C', status: 'NormalFinished', statusName: '거래완료', price: '1,000원', purePrice: 1000, realizedSum: 1000, progressRatio: '100%', startDateTime: '26. 05. 01', endDateTime: '26. 05. 31', remainderDays: 0, source: 'after' },
            { dealUsid: 'cancel-1', name: 'D', status: 'CancelByDepositRejection', statusName: '거래취소', price: '1,000원', purePrice: 1000, realizedSum: 0, progressRatio: '0%', startDateTime: '26. 05. 01', endDateTime: '26. 05. 31', remainderDays: 0, source: 'before' },
          ],
        },
      ],
    },
  ],
  onSaleByKeepAcct: {},
  summary: { totalUsingMembers: 2, totalActiveMembers: 4, totalIncome: 10000, totalRealized: 5000, totalAccounts: 1 },
  updatedAt: '2026-04-27T00:00:00.000Z',
} as any;

const manuals = [
  { id: 'manual-active', serviceType: '넷플릭스', accountEmail: 'netflix@example.com', memberName: 'manual', startDate: '2026-04-01', endDate: '2026-08-01', price: 5000, source: 'manual', memo: '', createdAt: '2026-04-01', status: 'active' },
] as any;

describe('dashboard stats', () => {
  test('matches management service user counts instead of adding manual members again', () => {
    const stats = buildServiceStats(data, manuals);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      serviceType: '넷플릭스',
      accountCount: 1,
      usingMembers: 2,
      maxSlots: 5,
    });
    expect(stats[0].fillRatio).toBeCloseTo(2 / 5);
  });

  test('builds expired party items and excludes cancelled deals from the expired party component', () => {
    const expired = buildExpiredPartyItems(data, manuals, { today: '2026-09-01' });
    expect(expired.map((item) => item.dealUsid).sort()).toEqual(['expired-1', 'manual-active']);
    const graytagExpired = expired.find((item) => item.dealUsid === 'expired-1');
    expect(graytagExpired).toMatchObject({
      serviceType: '넷플릭스',
      accountEmail: 'netflix@example.com',
      memberName: 'C',
      statusName: '거래완료',
    });
  });
});
