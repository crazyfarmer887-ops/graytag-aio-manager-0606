import { describe, expect, test } from 'vitest';
import { buildDailyInflow, buildExpiredPartyItems, buildMonthlyNetProfitSummary, buildPartyMaintenanceTargets, buildServiceStats } from '../src/web/lib/dashboard-stats';

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
  test('matches account-management occupied slot counts by adding active manual members', () => {
    const stats = buildServiceStats(data, manuals);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      serviceType: '넷플릭스',
      accountCount: 3,
      usingMembers: 5,
      maxSlots: 15,
    });
    expect(stats[0].fillRatio).toBeCloseTo(5 / 15);
  });

  test('calculates monthly net profit from daily member prices, Graytag fee, and OTT subscription cost', () => {
    const summary = buildMonthlyNetProfitSummary(data);
    expect(summary.netProfit).toBe(-44754);
    expect(summary.totalGrossIncome).toBe(6940);
    expect(summary.graytagFee).toBe(694);
    expect(summary.subscriptionCost).toBe(51000);
    expect(summary.manualIncome).toBe(0);
    expect(summary.fullPartyGrossIncome).toBe(26025);
    expect(summary.fullPartyGraytagFee).toBe(2602);
    expect(summary.fullPartyNetProfit).toBe(-27577);
    expect(summary.fullPartyUpside).toBe(17177);
    expect(summary.svcDetails).toEqual([
      {
        serviceType: '넷플릭스',
        accountCount: 3,
        partyMemberCount: 4,
        maxSlots: 15,
        grossIncome: 6940,
        graytagFee: 694,
        subscriptionCost: 51000,
        netProfit: -44754,
        fullPartyGrossIncome: 26025,
        fullPartyGraytagFee: 2602,
        fullPartyNetProfit: -27577,
        fullPartyUpside: 17177,
      },
    ]);
  });

  test('adds active manual members as direct monthly income without Graytag fee', () => {
    const summary = buildMonthlyNetProfitSummary(data, [
      { id: 'manual-active-monthly', serviceType: '넷플릭스', accountEmail: 'netflix@example.com', memberName: 'manual active', startDate: '2026-04-01', endDate: '2026-05-01', price: 6000, source: 'manual', memo: '', createdAt: '2026-04-01', status: 'active' },
      { id: 'manual-expired', serviceType: '넷플릭스', accountEmail: 'netflix@example.com', memberName: 'manual expired', startDate: '2026-02-01', endDate: '2026-03-01', price: 9000, source: 'manual', memo: '', createdAt: '2026-02-01', status: 'expired' },
      { id: 'manual-cancelled', serviceType: '넷플릭스', accountEmail: 'netflix@example.com', memberName: 'manual cancelled', startDate: '2026-04-01', endDate: '2026-05-01', price: 6000, source: 'manual', memo: '', createdAt: '2026-04-01', status: 'cancelled' },
    ] as any, { today: '2026-04-15' });
    expect(summary.manualIncome).toBe(6000);
    expect(summary.totalGrossIncome).toBe(12940);
    expect(summary.graytagFee).toBe(694);
    expect(summary.netProfit).toBe(-38754);
    expect(summary.fullPartyNetProfit).toBe(-21577);
    expect(summary.fullPartyUpside).toBe(17177);
  });

  test('excludes recruiting/generated-only rows from actual party counts and subscription costs', () => {
    const partyData = {
      services: [{
        serviceType: '넷플릭스',
        totalUsingMembers: 1,
        totalActiveMembers: 3,
        totalIncome: 14000,
        totalRealized: 0,
        accounts: [
          {
            email: 'real-party@example.com', serviceType: '넷플릭스', usingCount: 1, activeCount: 1,
            totalSlots: 5, totalIncome: 5000, totalRealizedIncome: 0, expiryDate: '2026-07-01',
            members: [{ dealUsid: 'using-real', name: 'Real', status: 'Using', statusName: '사용중', price: '5,000원', purePrice: 5000, realizedSum: 0, progressRatio: '50%', startDateTime: '2026-06-01', endDateTime: '2026-07-01', remainderDays: 10, source: 'after' }],
          },
          {
            email: 'on-sale-only@example.com', serviceType: '넷플릭스', usingCount: 0, activeCount: 1,
            totalSlots: 5, totalIncome: 9000, totalRealizedIncome: 0, expiryDate: '2026-07-01',
            members: [{ dealUsid: 'sale-only', name: null, status: 'OnSale', statusName: '판매중', price: '9,000원', purePrice: 9000, realizedSum: 0, progressRatio: '0%', startDateTime: '2026-06-01', endDateTime: '2026-07-01', remainderDays: 30, source: 'before' }],
            onSaleAccount: { productCount: 1 },
          },
          {
            email: 'generated-only@example.com', serviceType: '넷플릭스', usingCount: 0, activeCount: 0,
            totalSlots: 5, totalIncome: 0, totalRealizedIncome: 0, expiryDate: null,
            members: [], generatedAccount: { id: 'generated-1' },
          },
        ],
      }],
      onSaleByKeepAcct: {},
      summary: { totalUsingMembers: 1, totalActiveMembers: 3, totalIncome: 14000, totalRealized: 0, totalAccounts: 3 },
      updatedAt: '2026-06-01T00:00:00.000Z',
    } as any;

    const stats = buildServiceStats(partyData);
    expect(stats[0]).toMatchObject({ accountCount: 1, usingMembers: 1, maxSlots: 5 });

    const summary = buildMonthlyNetProfitSummary(partyData);
    expect(summary.subscriptionCost).toBe(17000);
    expect(summary.totalGrossIncome).toBe(5000);
    expect(summary.graytagFee).toBe(500);
    expect(summary.netProfit).toBe(-12500);
    expect(summary.svcDetails[0]).toMatchObject({
      serviceType: '넷플릭스',
      accountCount: 1,
      partyMemberCount: 1,
      maxSlots: 5,
      grossIncome: 5000,
      subscriptionCost: 17000,
      fullPartyGrossIncome: 25000,
      fullPartyNetProfit: 5500,
    });
  });

  test('excludes paid generated double-pass accounts from trading/profit calculations', () => {
    const partyData = {
      services: [{
        serviceType: '티빙+웨이브',
        totalUsingMembers: 0,
        totalActiveMembers: 0,
        totalIncome: 0,
        totalRealized: 0,
        accounts: [{
          email: 'gtwavve7@example.com', serviceType: '티빙+웨이브', usingCount: 0, activeCount: 0,
          totalSlots: 4, totalIncome: 0, totalRealizedIncome: 0, expiryDate: null,
          members: [], generatedAccount: { id: 'generated-1', paymentStatus: 'paid' },
        }],
      }],
      onSaleByKeepAcct: {},
      summary: { totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0, totalAccounts: 1 },
      updatedAt: '2026-06-01T00:00:00.000Z',
    } as any;

    const stats = buildServiceStats(partyData);
    expect(stats).toEqual([]);

    const summary = buildMonthlyNetProfitSummary(partyData);
    expect(summary.subscriptionCost).toBe(0);
    expect(summary.netProfit).toBe(0);
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

  test('includes manual party members whose recruitment start date is today in daily inflow', () => {
    const rows = buildDailyInflow(data, [
      ...manuals,
      { id: 'manual-today', serviceType: '웨이브', accountEmail: 'wavve@example.com', memberName: 'manual today', startDate: '2026-04-30', endDate: '2026-07-09', price: 8400, source: 'manual', memo: '', createdAt: '2026-04-30', status: 'active' },
      { id: 'manual-cancelled-today', serviceType: '웨이브', accountEmail: 'wavve@example.com', memberName: 'cancelled today', startDate: '2026-04-30', endDate: '2026-07-09', price: 8400, source: 'manual', memo: '', createdAt: '2026-04-30', status: 'cancelled' },
    ] as any, { days: 3, today: '2026-04-30' });
    const today = rows.find((row) => row.date === '2026-04-30');
    expect(today?.members.map((member) => member.name)).toContain('manual today');
    expect(today?.members.map((member) => member.name)).not.toContain('cancelled today');
    expect(today?.members.find((member) => member.name === 'manual today')).toMatchObject({
      serviceType: '웨이브',
      accountEmail: 'wavve@example.com',
      startDate: '2026-04-30',
      endDate: '2026-07-09',
      price: '8,400원',
      source: 'manual',
    });
  });


  test('includes 계정확인중 Graytag members in daily inflow and groups counts by service', () => {
    const rows = buildDailyInflow({
      ...data,
      services: [
        ...data.services,
        {
          serviceType: '웨이브',
          totalUsingMembers: 1,
          totalActiveMembers: 1,
          totalIncome: 7000,
          totalRealized: 0,
          accounts: [{
            email: 'wavve-check@example.com',
            serviceType: '웨이브',
            usingCount: 1,
            activeCount: 1,
            totalSlots: 4,
            totalIncome: 7000,
            totalRealizedIncome: 0,
            expiryDate: '2026-07-09',
            members: [
              { dealUsid: 'checking-1', name: 'Checking', status: 'Delivered', statusName: '계정확인중', price: '7,000원', purePrice: 7000, realizedSum: 0, progressRatio: '0%', startDateTime: null, inflowDateTime: '2026-04-30T09:00:00', endDateTime: '2026-07-09', remainderDays: 70, source: 'before' },
            ],
          }],
        },
      ],
    } as any, manuals, { days: 3, today: '2026-04-30' });
    const today = rows.find((row) => row.date === '2026-04-30');
    expect(today?.members.find((member) => member.name === 'Checking')).toMatchObject({
      serviceType: '웨이브',
      status: 'Delivered',
      statusName: '계정확인중',
      startDate: '2026-04-30',
      source: 'graytag',
    });
    expect(today?.byService['웨이브']).toBe(1);
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

  test('alerts when the earliest active party member expires before the account subscription', () => {
    const memberFirstData = {
      ...data,
      services: [{
        serviceType: '넷플릭스',
        totalUsingMembers: 1,
        totalActiveMembers: 1,
        totalIncome: 9000,
        totalRealized: 0,
        accounts: [{
          email: 'member-first@example.com',
          serviceType: '넷플릭스',
          usingCount: 1,
          activeCount: 1,
          totalSlots: 5,
          totalIncome: 9000,
          totalRealizedIncome: 0,
          expiryDate: '2026-06-30',
          members: [
            { dealUsid: 'early-member', name: 'Early', status: 'Using', statusName: '사용중', price: '9,000원', purePrice: 9000, realizedSum: 0, progressRatio: '80%', startDateTime: '2026-04-01', endDateTime: '2026-05-04', remainderDays: 1, source: 'after' },
            { dealUsid: 'late-member', name: 'Late', status: 'Using', statusName: '사용중', price: '9,000원', purePrice: 9000, realizedSum: 0, progressRatio: '20%', startDateTime: '2026-04-01', endDateTime: '2026-06-15', remainderDays: 42, source: 'after' },
          ],
        }],
      }],
    } as any;

    const targets = buildPartyMaintenanceTargets(memberFirstData, { today: '2026-05-03', expiringWithinDays: 7 });

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      accountEmail: 'member-first@example.com',
      reason: 'member-expiring-first',
      reasonLabel: '파티원 먼저 만료',
      expiryDate: '2026-05-04',
      daysUntilExpiry: 1,
      lastMemberName: 'Early',
    });
    expect(targets[0].noticeMembers.map(member => member.dealUsid)).toContain('early-member');
  });
});
