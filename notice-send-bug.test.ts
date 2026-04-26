import { describe, test, expect } from 'vitest';

/**
 * 버그 재현 테스트:
 * 현재 notice/send는 findAfterUsingLenderDeals API를 사용해서 파티원을 조회하는데,
 * 이 API 응답에는 keepAcct 필드가 없거나 chatRoomUuid가 없어서 발송 대상이 0명이 됨.
 *
 * 올바른 로직: chat/rooms (이미 keepAcct + chatRoomUuid 다 있음)에서 직접 필터링해야 함.
 */

// ── 현재 버그 있는 로직 ──────────────────────────────────────────
function findTargetsViaAfterDeals(
  afterDeals: Array<{ dealUsid: string; keepAcct?: string; dealStatus: string }>,
  dealToRoom: Map<string, string>,
  targetEmail: string,
  allowedStatuses: Set<string>
) {
  const email = targetEmail.trim().toLowerCase();
  const targets = afterDeals.filter(d =>
    (d.keepAcct || '').trim().toLowerCase() === email &&
    allowedStatuses.has(d.dealStatus)
  );
  return targets.map(d => ({
    ...d,
    chatRoomUuid: dealToRoom.get(d.dealUsid) || '',
  }));
}

// ── 올바른 로직 ─────────────────────────────────────────────────
function findTargetsViaRooms(
  rooms: Array<{ dealUsid: string; chatRoomUuid: string; keepAcct?: string; dealStatus: string }>,
  targetEmail: string,
  allowedStatuses: Set<string>
) {
  const email = targetEmail.trim().toLowerCase();
  return rooms.filter(r =>
    (r.keepAcct || '').trim().toLowerCase() === email &&
    allowedStatuses.has(r.dealStatus)
  );
}

describe('notice/send 버그 재현 및 수정 검증', () => {
  const ALLOWED = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
  const TARGET = 'disney2.dollhouse753@aleeas.com';

  // chat/rooms에는 keepAcct + chatRoomUuid 둘 다 있음 (실제 API 응답 구조)
  const rooms = [
    { dealUsid: '000000000CRKH', chatRoomUuid: 'b535684b', keepAcct: TARGET, dealStatus: 'UsingNearExpiration' },
    { dealUsid: '000000000CRKN', chatRoomUuid: 'bbb114ca', keepAcct: TARGET, dealStatus: 'UsingNearExpiration' },
    { dealUsid: '000000000CRK0', chatRoomUuid: '735ee1d9', keepAcct: TARGET, dealStatus: 'UsingNearExpiration' },
  ];

  // findAfterUsingLenderDeals 응답에는 keepAcct가 없는 경우 많음
  const afterDealsWithoutKeepAcct = [
    { dealUsid: '000000000CRKH', dealStatus: 'UsingNearExpiration' },  // keepAcct 없음
    { dealUsid: '000000000CRKN', dealStatus: 'UsingNearExpiration' },  // keepAcct 없음
  ];

  const dealToRoomMap = new Map(rooms.map(r => [r.dealUsid, r.chatRoomUuid]));

  test('[BUG] afterDeals 기반 로직 → keepAcct 없으면 발송 대상 0명', () => {
    const targets = findTargetsViaAfterDeals(afterDealsWithoutKeepAcct, dealToRoomMap, TARGET, ALLOWED);
    // 버그: keepAcct가 없어서 email 매칭 실패 → 0명
    expect(targets).toHaveLength(0);
  });

  test('[FIX] rooms 기반 로직 → keepAcct + chatRoomUuid 모두 있어서 정상 발송', () => {
    const targets = findTargetsViaRooms(rooms, TARGET, ALLOWED);
    // 수정: rooms에서 직접 필터 → 3명 정상 검출
    expect(targets).toHaveLength(3);
    expect(targets.every(r => r.chatRoomUuid !== '')).toBe(true);
  });

  test('[FIX] 발송 가능한(chatRoomUuid 있는) 대상만 카운트', () => {
    const targets = findTargetsViaRooms(rooms, TARGET, ALLOWED);
    const sendable = targets.filter(r => r.chatRoomUuid);
    expect(sendable.length).toBeGreaterThan(0);
  });

  test('[FIX] 다른 계정 이메일은 포함되지 않음', () => {
    const targets = findTargetsViaRooms(rooms, 'other@test.com', ALLOWED);
    expect(targets).toHaveLength(0);
  });

  test('[FIX] allowedStatuses 외 상태는 제외', () => {
    const mixedRooms = [
      ...rooms,
      { dealUsid: 'EXTRA', chatRoomUuid: 'RXXX', keepAcct: TARGET, dealStatus: 'Finished' },
    ];
    const targets = findTargetsViaRooms(mixedRooms, TARGET, ALLOWED);
    expect(targets.find(r => r.dealStatus === 'Finished')).toBeUndefined();
    expect(targets).toHaveLength(3);
  });
});
