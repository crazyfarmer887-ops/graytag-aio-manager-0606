import { describe, expect, test } from 'vitest';
import { assertAutoDeliveryInput, buildAutoFillDeliveryMemo, buildFillProductModel, buildFinishedDealsUrl, findExactPasswordForAccount, makeDefaultSellingGuide, requireExactAliasMemoForAutoFill } from './src/lib/graytag-fill';

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

  test('auto-fill delivery memo prepends the repeated assigned-profile warning', () => {
    const memo = buildAutoFillDeliveryMemo('수달이', '✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!!');

    expect(memo.startsWith('⚠️ 1인 1프로필 원칙 안내 ⚠️')).toBe(true);
    expect(memo.match(/⚠️ 1인 1프로필 원칙 안내 ⚠️/g)).toHaveLength(3);
    expect(memo.match(/배정된 프로필 이름 : 수달이/g)).toHaveLength(3);
    expect(memo.match(/프로필을 만드실 때 해당 이름으로 꼭 만드신 뒤 사용하셔야 합니다\. 그리고 반드시 위 프로필만 사용해주세요\./g)).toHaveLength(3);
    expect(memo).toContain('✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!!');
    expect(memo).not.toContain('배정 프로필:');
    expect(memo).not.toContain('프로필명이 없거나 접속이 안 되면');
  });

  test('management lookup can request both current-only and finished-included deal lists', () => {
    expect(buildFinishedDealsUrl('before', 3)).toContain('findBeforeUsingLenderDeals?finishedDealIncluded=true');
    expect(buildFinishedDealsUrl('after', 2)).toContain('findAfterUsingLenderDeals?finishedDealIncluded=true');
    expect(buildFinishedDealsUrl('before', 1, 500, false)).toContain('findBeforeUsingLenderDeals?finishedDealIncluded=false');
    expect(buildFinishedDealsUrl('after', 1, 500, false)).toContain('findAfterUsingLenderDeals?finishedDealIncluded=false');
  });

  test('password lookup never falls back to another account or service', () => {
    const onSaleByKeepAcct = {
      'acct@example.com': [
        { keepAcct: 'acct@example.com', productType: '넷플릭스', keepPasswd: 'netflix-pw' },
        { keepAcct: 'acct@example.com', productType: '티빙', keepPasswd: 'tving-pw' },
      ],
      'other@example.com': [
        { keepAcct: 'other@example.com', productType: '티빙', keepPasswd: 'other-pw' },
      ],
    };

    expect(findExactPasswordForAccount('acct@example.com', '티빙', [], onSaleByKeepAcct)).toBe('tving-pw');
    expect(findExactPasswordForAccount('acct@example.com', '웨이브', [], onSaleByKeepAcct)).toBe('');
    expect(findExactPasswordForAccount('missing@example.com', '티빙', [], onSaleByKeepAcct)).toBe('');
  });

  test('auto-fill requires an exact email dashboard memo before registering', () => {
    expect(requireExactAliasMemoForAutoFill({ statusOk: true, memo: 'exact memo', expectedMemo: 'exact memo' })).toBeNull();
    expect(requireExactAliasMemoForAutoFill({ statusOk: false, memo: 'fallback memo', expectedMemo: 'fallback memo' })).toContain('이메일/PIN');
    expect(requireExactAliasMemoForAutoFill({ statusOk: true, memo: '', expectedMemo: 'exact memo' })).toContain('전달 문구');
    expect(requireExactAliasMemoForAutoFill({ statusOk: true, memo: 'edited memo', expectedMemo: 'exact memo' })).toContain('변경되어');
  });
});
