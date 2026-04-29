import { describe, expect, test } from 'vitest';
import { groupChatRoomsByAccount, sortChatRoomsByLatestBuyerMessage, type SortableChatRoom } from '../src/web/lib/chat-room-sort';

const room = (input: Partial<SortableChatRoom> & Pick<SortableChatRoom, 'dealUsid' | 'chatRoomUuid'>): SortableChatRoom => ({
  dealUsid: input.dealUsid,
  chatRoomUuid: input.chatRoomUuid,
  borrowerName: input.borrowerName || '구매자',
  productType: input.productType || '웨이브',
  keepAcct: input.keepAcct || '(직접전달)',
  lenderChatUnread: Boolean(input.lenderChatUnread),
  lastMessage: input.lastMessage,
  lastMessageTime: input.lastMessageTime,
});

describe('chat room sorting modes', () => {
  test('latest buyer message mode sorts unread buyer rooms by newest buyer message time by default', () => {
    const sorted = sortChatRoomsByLatestBuyerMessage([
      room({ dealUsid: '100', chatRoomUuid: 'old', borrowerName: '오래전', lenderChatUnread: true, lastMessageTime: '2026.04.03 13:14' }),
      room({ dealUsid: '101', chatRoomUuid: 'read-newer', borrowerName: '읽은 최신', lenderChatUnread: false, lastMessageTime: '2026.04.24 09:00' }),
      room({ dealUsid: '102', chatRoomUuid: 'new', borrowerName: '최근 문의', lenderChatUnread: true, lastMessageTime: '2026.04.23 00:01' }),
    ]);

    expect(sorted.map((r) => r.chatRoomUuid)).toEqual(['new', 'old', 'read-newer']);
  });

  test('account grouping mode keeps service/account groups and sorts rooms inside each group by newest message', () => {
    const groups = groupChatRoomsByAccount([
      room({ dealUsid: '100', chatRoomUuid: 'older', productType: '웨이브', keepAcct: 'wavve1', lastMessageTime: '2026.04.03 13:14' }),
      room({ dealUsid: '101', chatRoomUuid: 'newer', productType: '웨이브', keepAcct: 'wavve1', lastMessageTime: '2026.04.23 00:01' }),
      room({ dealUsid: '102', chatRoomUuid: 'other', productType: '티빙', keepAcct: 'tving1', lastMessageTime: '2026.04.22 00:01' }),
    ]);

    expect(Object.keys(groups)).toEqual(['웨이브', '티빙']);
    expect(groups['웨이브']['wavve1'].map((r) => r.chatRoomUuid)).toEqual(['newer', 'older']);
  });
});
