import { describe, expect, test } from 'vitest';
import { buildChatAlerts, buildUnreadChatAlerts } from '../src/web/lib/chat-alerts';

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

  test('limits and hides empty inquiry messages', () => {
    const alerts = buildChatAlerts([
      { dealUsid: '1', chatRoomUuid: 'a', borrowerName: '', productType: '웨이브', productName: '웨이브', lenderChatUnread: true, lastMessage: '' },
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
});
