import { describe, expect, test } from 'vitest';
import { removeRecruitingProductFromManageData } from '../src/web/lib/manage-optimistic';

describe('removeRecruitingProductFromManageData', () => {
  test('removes the deleted recruiting product immediately from the matching account list', () => {
    const data = {
      onSaleByKeepAcct: {
        'gtwalve4': [
          { productUsid: 'keep-me', productType: '티빙', price: '1,000원' },
          { productUsid: 'delete-me', productType: '티빙', price: '2,000원' },
        ],
        other: [
          { productUsid: 'delete-me', productType: '넷플릭스', price: '9,000원' },
        ],
      },
    };

    const next = removeRecruitingProductFromManageData(data, 'gtwalve4', 'delete-me');

    expect(next).not.toBe(data);
    expect(next.onSaleByKeepAcct.gtwalve4.map(p => p.productUsid)).toEqual(['keep-me']);
    expect(next.onSaleByKeepAcct.other.map(p => p.productUsid)).toEqual(['delete-me']);
    expect(data.onSaleByKeepAcct.gtwalve4.map(p => p.productUsid)).toEqual(['keep-me', 'delete-me']);
  });
});
