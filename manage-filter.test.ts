import { test, expect } from 'vitest';

type FilterMode = 'using' | 'active' | 'all';

// 수정된 로직
function shouldShowAccount(
  acct: { usingCount: number; activeCount: number; email: string },
  filter: FilterMode,
  onSaleByKeepAcct: Record<string, any[]>
): boolean {
  const hasOnSale = (onSaleByKeepAcct?.[acct.email]?.length ?? 0) > 0;
  if (filter !== 'all' && acct.usingCount === 0 && acct.activeCount === 0 && !hasOnSale) return false;
  return true;
}

test('account with 0 members but OnSale products should be visible in using filter', () => {
  const acct = { usingCount: 0, activeCount: 0, email: 'netflix4.animate690@aleeas.com' };
  const onSaleByKeepAcct = {
    'netflix4.animate690@aleeas.com': [
      { productUsid: '0000000045XHH', productType: '넷플릭스' }
    ]
  };
  expect(shouldShowAccount(acct, 'using', onSaleByKeepAcct)).toBe(true);
});

test('account with 0 members and NO OnSale products should be hidden in using filter', () => {
  const acct = { usingCount: 0, activeCount: 0, email: 'old-account@aleeas.com' };
  expect(shouldShowAccount(acct, 'using', {})).toBe(false);
});

test('account with members should always be visible in using filter', () => {
  const acct = { usingCount: 3, activeCount: 3, email: 'wavve1.recount380@aleeas.com' };
  expect(shouldShowAccount(acct, 'using', {})).toBe(true);
});

test('all accounts visible in all filter', () => {
  const acct = { usingCount: 0, activeCount: 0, email: 'empty@aleeas.com' };
  expect(shouldShowAccount(acct, 'all', {})).toBe(true);
});
