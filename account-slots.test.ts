import { describe, expect, test } from 'vitest';
import { buildAccountSlotStates, dedupeRecruitingProducts, mergeRecruitingProducts } from './src/web/lib/account-slots';

describe('account slot UI helpers', () => {
  test('renders recruiting posts as gray slot state after existing and manual users', () => {
    expect(buildAccountSlotStates({
      totalSlots: 6,
      usingCount: 2,
      manualCount: 0,
      recruitingCount: 4,
    })).toEqual(['using', 'using', 'recruiting', 'recruiting', 'recruiting', 'recruiting']);
  });

  test('does not double count duplicate recruiting productUsid values', () => {
    const products = dedupeRecruitingProducts([
      { productUsid: 'P1', price: '1000원' },
      { productUsid: 'P1', price: '1000원' },
      { productUsid: 'P2', price: '1200원' },
    ]);

    expect(products.map(p => p.productUsid)).toEqual(['P1', 'P2']);
  });

  test('merges newly registered recruiting posts without duplicating existing posts', () => {
    const merged = mergeRecruitingProducts(
      [{ productUsid: 'P1', price: '1000원' }],
      [{ productUsid: 'P1', price: '1000원' }, { productUsid: 'P2', price: '1200원' }]
    );

    expect(merged.map(p => p.productUsid)).toEqual(['P1', 'P2']);
  });
});
