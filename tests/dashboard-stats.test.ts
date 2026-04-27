import { describe, expect, test } from 'vitest';
import { buildExpiredPartyItems, buildPartyMaintenanceTargets, buildServiceStats } from '../src/web/lib/dashboard-stats';

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
        {
          email: 'empty-old@example.com',
          serviceType: '넷플릭스',
          usingCount: 0,
          activeCount: 0,
          totalSlots: 5,
          totalIncome: 0,
          totalRealizedIncome: 12000,
          expiryDate: '2026-04-12',
          members: [
            { dealUsid: 'old-ended-1', name: 'Old', status: 'NormalFinished', statusName: '거래완료', price: '6,000원', purePrice: 6000, realizedSum: 6000, progressRatio: '100%', startDateTime: '26. 03. 01', endDateTime: '26. 04. 12', remainderDays: 0, source: 'after' },
          ],
        },
        {
          email: 'soon@example.com',
          serviceType: '넷플릭스',
          usingCount: 1,
          activeCount: 1,
          totalSlots: 5,
          totalIncome: 3000,
          totalRealizedIncome: 3000,
          expiryDate: '26. 04. 30',
          members: [
            { dealUsid: 'soon-1', name: 'Soon', status: 'UsingNearExpiration', statusName: '종료임박', price: '3,000원', purePrice: 3000, realizedSum: 3000, progressRatio: '95%', startDateTime: '26. 04. 01', endDateTime: '26. 04. 30', remainderDays: 2, source: 'after' },
          ],
        },
        {
          email: 'later@example.com',
          serviceType: '넷플릭스',
          usingCount: 1,
          activeCount: 1,
          totalSlots: 5,
          totalIncome: 3000,
          totalRealizedIncome: 3000,
          expiryDate: '2026-05-20',
          members: [
            { dealUsid: 'later-1', name: 'Later', status: 'Using', statusName: '사용중', price: '3,000원', purePrice: 3000, realizedSum: 1000, progressRatio: '30%', startDateTime: '26. 04. 01', endDateTime: '26. 05. 20', remainderDays: 22, source: 'after' },
          ],
        },
      ],
    },
  ],
  onSaleByKeepAcct: {},
  summary: { totalUsingMembers: 4, totalActiveMembers: 6, totalIncome: 16000, totalRealized: 23000, totalAccounts: 4 },
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
      accountCount: 3,
      usingMembers: 4,
      maxSlots: 15,
    });
    expect(stats[0].fillRatio).toBeCloseTo(4 / 15);
  });

  test('builds expired party items and excludes cancelled deals from the expired party component', () => {
    const expired = buildExpiredPartyItems(data, manuals, { today: '2026-09-01' });
    expect(expired.map((item) => item.dealUsid).sort()).toEqual(['expired-1', 'manual-active', 'old-ended-1']);
    const graytagExpired = expired.find((item) => item.dealUsid === 'expired-1');
    expect(graytagExpired).toMatchObject({
      serviceType: '넷플릭스',
      accountEmail: 'netflix@example.com',
      memberName: 'C',
      statusName: '거래완료',
    });
  });

  test('builds maintenance targets from accounts with no current users or expiry within 7 days', () => {
    const targets = buildPartyMaintenanceTargets(data, { today: '2026-04-28', expiringWithinDays: 7 });
    expect(targets.map((item) => item.accountEmail)).toEqual(['soon@example.com', 'empty-old@example.com']);
    expect(targets[0]).toMatchObject({
      serviceType: '넷플릭스',
      accountEmail: 'soon@example.com',
      reason: 'expiring-soon',
      daysUntilExpiry: 2,
      usingCount: 1,
    });
    expect(targets[1]).toMatchObject({
      accountEmail: 'empty-old@example.com',
      reason: 'no-current-users',
      usingCount: 0,
    });
  });
});
