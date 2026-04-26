import { describe, test, expect } from 'vitest';

// ── 테스트 대상 순수 함수들 ──────────────────────────────────────
// notice/send 핵심 로직을 분리해서 테스트

/**
 * chat/rooms 응답에서 dealUsid → chatRoomUuid 맵 생성
 */
function buildDealToRoomMap(rooms: Array<{ dealUsid: string; chatRoomUuid: string; keepAcct?: string }>) {
  const map = new Map<string, string>();
  for (const r of rooms) {
    if (r.dealUsid && r.chatRoomUuid) map.set(r.dealUsid, r.chatRoomUuid);
  }
  return map;
}

/**
 * chat/rooms 응답에서 keepAcct(이메일) 기준으로 대상 방 목록 추출
 * notice/send의 핵심: afterDeals가 아닌 rooms에서 직접 필터링해야 함
 */
function filterRoomsByEmail(
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

// ── 테스트 ──────────────────────────────────────────────────────

describe('buildDealToRoomMap', () => {
  test('dealUsid → chatRoomUuid 맵 정확히 생성', () => {
    const rooms = [
      { dealUsid: 'DEAL1', chatRoomUuid: 'ROOM1', keepAcct: 'a@b.com' },
      { dealUsid: 'DEAL2', chatRoomUuid: 'ROOM2', keepAcct: 'a@b.com' },
    ];
    const map = buildDealToRoomMap(rooms);
    expect(map.get('DEAL1')).toBe('ROOM1');
    expect(map.get('DEAL2')).toBe('ROOM2');
  });

  test('chatRoomUuid 없는 항목은 맵에서 제외', () => {
    const rooms = [
      { dealUsid: 'DEAL1', chatRoomUuid: '' },
      { dealUsid: 'DEAL2', chatRoomUuid: 'ROOM2' },
    ];
    const map = buildDealToRoomMap(rooms);
    expect(map.has('DEAL1')).toBe(false);
    expect(map.has('DEAL2')).toBe(true);
  });
});

describe('filterRoomsByEmail', () => {
  const ALLOWED = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);

  const rooms = [
    { dealUsid: 'D1', chatRoomUuid: 'R1', keepAcct: 'disney2.dollhouse753@aleeas.com', dealStatus: 'UsingNearExpiration' },
    { dealUsid: 'D2', chatRoomUuid: 'R2', keepAcct: 'disney2.dollhouse753@aleeas.com', dealStatus: 'UsingNearExpiration' },
    { dealUsid: 'D3', chatRoomUuid: 'R3', keepAcct: 'other@aleeas.com', dealStatus: 'Using' },
    { dealUsid: 'D4', chatRoomUuid: 'R4', keepAcct: 'disney2.dollhouse753@aleeas.com', dealStatus: 'Finished' },
  ];

  test('targetEmail에 맞는 방만 반환', () => {
    const result = filterRoomsByEmail(rooms, 'disney2.dollhouse753@aleeas.com', ALLOWED);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.keepAcct === 'disney2.dollhouse753@aleeas.com')).toBe(true);
  });

  test('이메일 대소문자 무시', () => {
    const result = filterRoomsByEmail(rooms, 'DISNEY2.DOLLHOUSE753@ALEEAS.COM', ALLOWED);
    expect(result).toHaveLength(2);
  });

  test('allowedStatuses 밖의 거래는 제외', () => {
    const result = filterRoomsByEmail(rooms, 'disney2.dollhouse753@aleeas.com', ALLOWED);
    expect(result.every(r => ALLOWED.has(r.dealStatus))).toBe(true);
    // Finished는 제외됨
    expect(result.find(r => r.dealStatus === 'Finished')).toBeUndefined();
  });

  test('대상 이메일 없으면 빈 배열', () => {
    const result = filterRoomsByEmail(rooms, 'notexist@aleeas.com', ALLOWED);
    expect(result).toHaveLength(0);
  });
});

describe('notice/send 통합 시나리오 (실제 API 미사용)', () => {
  test('chat/rooms 기반으로 발송 대상 수 올바르게 계산', () => {
    const ALLOWED = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
    const rooms = [
      { dealUsid: 'D1', chatRoomUuid: 'R1', keepAcct: 'target@test.com', dealStatus: 'Using' },
      { dealUsid: 'D2', chatRoomUuid: 'R2', keepAcct: 'target@test.com', dealStatus: 'UsingNearExpiration' },
      { dealUsid: 'D3', chatRoomUuid: '',   keepAcct: 'target@test.com', dealStatus: 'Using' },  // chatRoomUuid 없음 → skip
      { dealUsid: 'D4', chatRoomUuid: 'R4', keepAcct: 'other@test.com',  dealStatus: 'Using' },  // 다른 계정
    ];

    const targets = filterRoomsByEmail(rooms, 'target@test.com', ALLOWED);
    expect(targets).toHaveLength(3); // chatRoomUuid 없는 것도 일단 포함

    const withRoom = targets.filter(r => r.chatRoomUuid);
    const skipped = targets.filter(r => !r.chatRoomUuid);
    expect(withRoom).toHaveLength(2); // 실제 발송 가능
    expect(skipped).toHaveLength(1);  // chatRoomUuid 없어서 skip
  });
});
