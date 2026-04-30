import { describe, expect, test } from 'vitest';
import { buildChatAlerts, buildLatestChatMessages, buildUnreadChatAlerts, parseChatTime } from '../src/web/lib/chat-alerts';

describe('chat alerts', () => {
  test('shows unread buyer inquiries first with buyer, service, product and message', () => {
    const alerts = buildChatAlerts([
      {
        dealUsid: '100', chatRoomUuid: 'room-old', borrowerName: '민수', productType: '티빙', productName: '티빙 3개월', lenderChatUnread: false, lastMessage: '감사합니다', lastMessageTime: '2026-04-26T09:00:00Z',
      },
      {
        dealUsid: '101', chatRoomUuid: 'room-new', borrowerName: '지영', productType: '넷플릭스', productName: '넷플릭스 프리미엄', lenderChatUnread: true, lastMessage: '<b>언제</b><br>시작되나요?', lastMessageTime: '2026-04-27T01:00:00Z',
      },
    ] as any);

    expect(alerts[0]).toMatchObject({
      id: 'room-new',
      buyerName: '지영',
      serviceType: '넷플릭스',
      productName: '넷플릭스 프리미엄',
      unread: true,
      message: '언제 시작되나요?',
    });
    expect(alerts[0].title).toContain('지영');
    expect(alerts[0].title).toContain('넷플릭스');
  });

  test('limits and hides empty read inquiry messages', () => {
    const alerts = buildChatAlerts([
      { dealUsid: '1', chatRoomUuid: 'a', borrowerName: '', productType: '웨이브', productName: '웨이브', lenderChatUnread: false, lastMessage: '' },
      { dealUsid: '2', chatRoomUuid: 'b', borrowerName: '구매자2', productType: '웨이브', productName: '웨이브', lenderChatUnread: true, lastMessage: '문의2' },
      { dealUsid: '3', chatRoomUuid: 'c', borrowerName: '구매자3', productType: '웨이브', productName: '웨이브', lenderChatUnread: true, lastMessage: '문의3' },
    ] as any, 1);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].buyerName).toBe('구매자2');
  });

  test('builds unread inquiry content list only from unread rooms', () => {
    const alerts = buildUnreadChatAlerts([
      { dealUsid: '10', chatRoomUuid: 'read', borrowerName: '읽은구매자', productType: '티빙', productName: '티빙', lenderChatUnread: false, lastMessage: '이미 답변함', lastMessageTime: '2026-04-27T01:00:00Z' },
      { dealUsid: '11', chatRoomUuid: 'unread-old', borrowerName: '수진', productType: '넷플릭스', productName: '넷플릭스', lenderChatUnread: true, lastMessage: '로그인 정보 언제 받을 수 있나요?', lastMessageTime: '2026-04-27T01:10:00Z' },
      { dealUsid: '12', chatRoomUuid: 'unread-new', borrowerName: '현우', productType: '디즈니', productName: '디즈니+', lenderChatUnread: true, lastMessage: '<p>프로필 이름 변경 가능해요?</p>', lastMessageTime: '2026-04-27T01:20:00Z' },
    ] as any);

    expect(alerts.map((item) => item.buyerName)).toEqual(['현우', '수진']);
    expect(alerts[0].message).toBe('프로필 이름 변경 가능해요?');
    expect(alerts.every((item) => item.unread)).toBe(true);
  });

  test('shows party manager context with account and readable message time', () => {
    const alerts = buildChatAlerts([
      {
        dealUsid: '200', chatRoomUuid: 'room-account', borrowerName: '진다솔', productType: '티빙', productName: '티빙 프리미엄', keepAcct: 'gtwavve4', lenderChatUnread: true, lastMessage: '프로필 꽉 찼어요', lastMessageTime: '2026.04.28 20:39',
      },
    ] as any);

    expect(alerts[0]).toMatchObject({
      accountLabel: 'gtwavve4',
      timeLabel: '4/28 20:39',
      missingMessage: false,
    });
    expect(alerts[0].title).toContain('gtwavve4');
  });

  test('keeps unread rooms visible when latest message fetch failed', () => {
    const alerts = buildUnreadChatAlerts([
      { dealUsid: '300', chatRoomUuid: 'room-missing', borrowerName: '김지만', productType: '디즈니플러스', productName: '디즈니플러스 프리미엄', keepAcct: 'crazyfarmer@kakao.com', lenderChatUnread: true, lastMessage: null, lastMessageTime: null },
    ] as any);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].missingMessage).toBe(true);
    expect(alerts[0].message).toContain('내용을 불러오지 못했어요');
    expect(alerts[0].accountLabel).toBe('crazyfarmer@kakao.com');
  });

  test('builds latest 10 messages from read and unread rooms by actual message time', () => {
    const rooms = Array.from({ length: 12 }, (_, index) => ({
      dealUsid: `latest-${index}`,
      chatRoomUuid: `latest-room-${index}`,
      borrowerName: `구매자${index}`,
      productType: '웨이브',
      productName: '웨이브',
      lenderChatUnread: index === 0,
      lastMessage: `메시지${index}`,
      lastMessageTime: `2026.04.${String(index + 1).padStart(2, '0')} 10:00`,
    }));
    const alerts = buildLatestChatMessages(rooms as any, 10);

    expect(alerts).toHaveLength(10);
    expect(alerts.map((item) => item.buyerName).slice(0, 3)).toEqual(['구매자11', '구매자10', '구매자9']);
    expect(alerts.some((item) => item.buyerName === '구매자0')).toBe(false);
    expect(alerts.some((item) => item.unread === false)).toBe(true);
  });

  test('parses Graytag dotted dates and sorts unread rooms by message time', () => {
    expect(parseChatTime('2026.04.28 20:39')).toBeGreaterThan(parseChatTime('2026.04.05 15:19'));
    const alerts = buildUnreadChatAlerts([
      { dealUsid: 'old', chatRoomUuid: 'old-room', borrowerName: '오래전', productType: '디즈니', productName: '디즈니', lenderChatUnread: true, lastMessage: '기본프로필이 없어요', lastMessageTime: '2026.04.05 15:19' },
      { dealUsid: 'new', chatRoomUuid: 'new-room', borrowerName: '최근', productType: '티빙', productName: '티빙', lenderChatUnread: true, lastMessage: '프로필 꽉 찼어요', lastMessageTime: '2026.04.28 20:39' },
    ] as any);

    expect(alerts.map((item) => item.buyerName)).toEqual(['최근', '오래전']);
  });
});
