import { describe, test, expect } from 'vitest';

/**
 * 파티별 추가공유 ON/OFF 로직 테스트
 *
 * 비즈니스 규칙:
 * - 각 계정(email) + 서비스(serviceType) 조합으로 ON/OFF 저장
 * - 저장된 값 없으면 기본값 true (ON)
 * - ON이면 EXTRA_INCOME, EXTRA_COST 계산에 포함
 * - OFF이면 extraProfit = 0, 캘린더 이벤트도 제외
 */

// ── 순수 로직 (storage 독립) ──────────────────────────────────────

import {
  makeExtraShareKey,
  getExtraShareOn,
  toggleExtraShare,
  applyExtraShare,
  type ExtraShareMap,
} from './extra-share';

describe('makeExtraShareKey', () => {
  test('이메일과 서비스타입을 __ 로 조합한다', () => {
    expect(makeExtraShareKey('netflix1@aleeas.com', '넷플릭스')).toBe('netflix1@aleeas.com__넷플릭스');
  });
});

describe('getExtraShareOn', () => {
  test('저장된 값 없으면 기본값 true', () => {
    const map: ExtraShareMap = {};
    expect(getExtraShareOn(map, 'a@b.com', '넷플릭스')).toBe(true);
  });

  test('명시적으로 false 저장된 경우 false 반환', () => {
    const map: ExtraShareMap = { 'a@b.com__넷플릭스': false };
    expect(getExtraShareOn(map, 'a@b.com', '넷플릭스')).toBe(false);
  });

  test('명시적으로 true 저장된 경우 true 반환', () => {
    const map: ExtraShareMap = { 'a@b.com__넷플릭스': true };
    expect(getExtraShareOn(map, 'a@b.com', '넷플릭스')).toBe(true);
  });

  test('다른 서비스의 설정은 영향 없음', () => {
    const map: ExtraShareMap = { 'a@b.com__티빙': false };
    expect(getExtraShareOn(map, 'a@b.com', '넷플릭스')).toBe(true);
  });
});

describe('toggleExtraShare', () => {
  test('기본(미설정) 상태에서 토글하면 false로 변경', () => {
    const map: ExtraShareMap = {};
    const next = toggleExtraShare(map, 'a@b.com', '넷플릭스');
    expect(next['a@b.com__넷플릭스']).toBe(false);
  });

  test('false 상태에서 토글하면 true로 변경', () => {
    const map: ExtraShareMap = { 'a@b.com__넷플릭스': false };
    const next = toggleExtraShare(map, 'a@b.com', '넷플릭스');
    expect(next['a@b.com__넷플릭스']).toBe(true);
  });

  test('원본 map은 변경하지 않는다 (immutable)', () => {
    const map: ExtraShareMap = {};
    toggleExtraShare(map, 'a@b.com', '넷플릭스');
    expect('a@b.com__넷플릭스' in map).toBe(false);
  });

  test('다른 키는 유지된다', () => {
    const map: ExtraShareMap = { 'b@c.com__티빙': false };
    const next = toggleExtraShare(map, 'a@b.com', '넷플릭스');
    expect(next['b@c.com__티빙']).toBe(false);
  });
});

describe('applyExtraShare', () => {
  const EXTRA_INCOME = { '넷플릭스': 18000, '티빙': 24000, '디즈니플러스': 5000 };
  const EXTRA_COST   = { '넷플릭스': 10000, '티빙': 15000 };

  test('ON이면 extraProfit = income - cost', () => {
    const map: ExtraShareMap = {};
    const result = applyExtraShare(map, 'acct@test.com', '넷플릭스', EXTRA_INCOME, EXTRA_COST, 1);
    expect(result).toBe(18000 - 10000); // 8000
  });

  test('ON + months=3이면 extraProfit = (income - cost) * 3', () => {
    const map: ExtraShareMap = {};
    const result = applyExtraShare(map, 'acct@test.com', '넷플릭스', EXTRA_INCOME, EXTRA_COST, 3);
    expect(result).toBe((18000 - 10000) * 3); // 24000
  });

  test('OFF이면 extraProfit = 0', () => {
    const map: ExtraShareMap = { 'acct@test.com__넷플릭스': false };
    const result = applyExtraShare(map, 'acct@test.com', '넷플릭스', EXTRA_INCOME, EXTRA_COST, 1);
    expect(result).toBe(0);
  });

  test('추가공유 없는 서비스(웨이브)는 항상 0', () => {
    const map: ExtraShareMap = {};
    const result = applyExtraShare(map, 'acct@test.com', '웨이브', EXTRA_INCOME, EXTRA_COST, 1);
    expect(result).toBe(0);
  });

  test('income만 있는 서비스(디즈니플러스)는 income 반환', () => {
    const map: ExtraShareMap = {};
    const result = applyExtraShare(map, 'acct@test.com', '디즈니플러스', EXTRA_INCOME, EXTRA_COST, 1);
    expect(result).toBe(5000);
  });
});
