import { describe, expect, test } from 'vitest';
import { buildProfileAuditRows, compareProfileCounts, summarizeProfileAudit } from '../src/lib/profile-audit';

const account = {
  email: 'netflix@example.com',
  serviceType: '넷플릭스',
  usingCount: 3,
  activeCount: 3,
  totalSlots: 5,
  totalIncome: 0,
  totalRealizedIncome: 0,
  expiryDate: null,
  members: [],
} as any;

const data = {
  services: [{ serviceType: '넷플릭스', totalUsingMembers: 3, totalActiveMembers: 3, totalIncome: 0, totalRealized: 0, accounts: [account] }],
  onSaleByKeepAcct: {},
  summary: { totalUsingMembers: 3, totalActiveMembers: 3, totalIncome: 0, totalRealized: 0, totalAccounts: 1 },
  updatedAt: '2026-04-27T00:00:00.000Z',
} as any;

const manuals = [
  { id: 'm1', accountEmail: 'netflix@example.com', serviceType: '넷플릭스', memberName: 'manual', startDate: '2026-04-01', endDate: '2026-06-01', price: 1000, source: 'manual', memo: '', createdAt: '2026-04-01', status: 'active' },
] as any;

describe('profile audit', () => {
  test('compares actual OTT profile count against account-management party count', () => {
    expect(compareProfileCounts(4, 4)).toBe('match');
    expect(compareProfileCounts(5, 4)).toBe('mismatch');
    expect(compareProfileCounts(null, 4)).toBe('unchecked');
  });

  test('builds rows using Graytag using count plus active manual members as expected profiles', () => {
    const rows = buildProfileAuditRows(data, manuals, {
      '넷플릭스::netflix@example.com': { actualProfileCount: 4, checkedAt: '2026-04-27T00:00:00.000Z', checker: 'mock' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serviceType: '넷플릭스',
      accountEmail: 'netflix@example.com',
      expectedPartyCount: 4,
      actualProfileCount: 4,
      status: 'match',
      checker: 'mock',
    });
  });

  test('summarizes profile audit statuses for the UI', () => {
    const rows = buildProfileAuditRows(data, [], {
      '넷플릭스::netflix@example.com': { actualProfileCount: 2, checkedAt: '2026-04-27T00:00:00.000Z', checker: 'mock' },
    });
    expect(summarizeProfileAudit(rows)).toMatchObject({ total: 1, match: 0, mismatch: 1, unchecked: 0 });
  });
});
