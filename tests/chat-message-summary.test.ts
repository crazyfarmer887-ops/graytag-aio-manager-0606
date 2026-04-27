import { describe, expect, test } from 'vitest';
import { extractGraytagChats, findLatestBuyerInquiryMessage } from '../src/api/chat-message-summary';

describe('chat message summary', () => {
  test('extracts chats from graytag nested and flat response shapes', () => {
    expect(extractGraytagChats({ data: { data: [{ message: 'flat' }] } })).toHaveLength(1);
    expect(extractGraytagChats({ data: { data: { chats: [{ message: 'nested' }] } } })).toHaveLength(1);
  });

  test('finds latest buyer inquiry message and skips info or owned messages', () => {
    const message = findLatestBuyerInquiryMessage([
      { message: '입장 안내', isInfo: true, isOwned: false, registeredDateTime: '2026-04-27T01:00:00Z' },
      { message: '판매자 답변', isInfo: false, isOwned: true, registeredDateTime: '2026-04-27T01:01:00Z' },
      { message: '<b>구매자 문의</b>', isInfo: false, isOwned: false, registeredDateTime: '2026-04-27T01:02:00Z' },
    ] as any);

    expect(message?.message).toBe('<b>구매자 문의</b>');
  });
});
