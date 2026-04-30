import { describe, expect, test } from 'vitest';
import { mergeOnSaleAccountsIntoManagement } from '../src/lib/on-sale-accounts';

describe('on-sale accounts management merge', () => {
  test('adds keepAcct-only on-sale products as empty account rows without counting them as active users', () => {
    const management = {
      services: [{ serviceType: '웨이브', accounts: [], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 }],
      summary: { totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0, totalAccounts: 0 },
    };
    const result = mergeOnSaleAccountsIntoManagement(management, {
      wavve7: [
        { productUsid: 'sale-1', productType: '웨이브', price: '8,400원', purePrice: 8400, keepAcct: 'wavve7', keepPasswd: 'secret' },
      ],
    });

    expect(result.services[0].accounts).toHaveLength(1);
    expect(result.services[0].accounts[0]).toMatchObject({
      serviceType: '웨이브',
      email: 'wavve7',
      usingCount: 0,
      activeCount: 0,
      totalSlots: 4,
      members: [],
      onSaleAccount: { productCount: 1 },
    });
    expect(result.services[0].totalUsingMembers).toBe(0);
    expect(result.services[0].totalActiveMembers).toBe(0);
    expect(result.summary.totalAccounts).toBe(1);
  });

  test('does not duplicate an account that already exists for the same service and keepAcct', () => {
    const management = {
      services: [{
        serviceType: '웨이브',
        accounts: [{ serviceType: '웨이브', email: 'wavve7', members: [], usingCount: 0, activeCount: 0, totalSlots: 4, totalIncome: 0, totalRealizedIncome: 0, expiryDate: null, generatedAccount: { id: 'generated-1' } }],
        totalUsingMembers: 0,
        totalActiveMembers: 0,
        totalIncome: 0,
        totalRealized: 0,
      }],
      summary: { totalAccounts: 1 },
    };
    const result = mergeOnSaleAccountsIntoManagement(management, {
      wavve7: [{ productUsid: 'sale-1', productType: '웨이브', keepAcct: 'wavve7' }],
    });
    expect(result.services[0].accounts).toHaveLength(1);
    expect(result.services[0].accounts[0].generatedAccount).toEqual({ id: 'generated-1' });
    expect(result.services[0].accounts[0].onSaleAccount).toEqual({ productCount: 1, source: 'graytag-on-sale' });
    expect(result.summary.totalAccounts).toBe(1);
  });
});
