import { describe, expect, test } from 'vitest';
import { assertAutoDeliveryInput, buildFillProductModel, buildFinishedDealsUrl, makeDefaultSellingGuide } from './src/lib/graytag-fill';

describe('graytag fill product helpers', () => {
  test('fill-created listings include the same selling guide as normal listing registration', () => {
    const model = buildFillProductModel({
      category: 'disney',
      endDate: '20260707T2359',
      price: 7970,
      productName: '디즈니플러스 프리미엄',
      serviceType: '디즈니플러스',
    });

    expect(model.sellingGuide).toBe(makeDefaultSellingGuide('디즈니플러스'));
    expect(model.sellingGuide).toContain('이메일 코드 언제든지 셀프인증 가능');
    expect(model.sellingGuide).toContain('1인 1기기 1계정');
    expect(model.sellingGuide).not.toBe('');
  });

  test('auto delivery requires account id, password, and delivery memo before counting as successful', () => {
    expect(assertAutoDeliveryInput({ keepAcct: 'acct@example.com', keepPasswd: 'pw', keepMemo: 'memo' })).toBeNull();
    expect(assertAutoDeliveryInput({ keepAcct: 'acct@example.com', keepPasswd: '', keepMemo: 'memo' })).toContain('비밀번호');
    expect(assertAutoDeliveryInput({ keepAcct: 'acct@example.com', keepPasswd: 'pw', keepMemo: '' })).toContain('전달 문구');
  });

  test('management lookup can request both current-only and finished-included deal lists', () => {
    expect(buildFinishedDealsUrl('before', 3)).toContain('findBeforeUsingLenderDeals?finishedDealIncluded=true');
    expect(buildFinishedDealsUrl('after', 2)).toContain('findAfterUsingLenderDeals?finishedDealIncluded=true');
    expect(buildFinishedDealsUrl('before', 1, 500, false)).toContain('findBeforeUsingLenderDeals?finishedDealIncluded=false');
    expect(buildFinishedDealsUrl('after', 1, 500, false)).toContain('findAfterUsingLenderDeals?finishedDealIncluded=false');
  });
});
