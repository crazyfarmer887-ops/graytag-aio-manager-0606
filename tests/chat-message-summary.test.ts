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

  test('uses the newest real buyer text, not system 안내 messages or array order', () => {
    const message = findLatestBuyerInquiryMessage([
      { message: '예전 문의입니다', isInfo: false, isOwned: false, registeredDateTime: '2026.04.03 13:00' },
      { message: '계정 정보가 전달되었습니다.\n구매확정 버튼을 눌러주세요.', informationMessage: true, owned: false, registeredDateTime: '2026.04.03 13:14' },
      { message: '최근 구매자 실제 문의입니다', isInfo: false, isOwned: false, registeredDateTime: '2026.04.23 00:01' },
      { message: '판매자 답변입니다', isInfo: false, isOwned: true, registeredDateTime: '2026.04.23 00:03' },
      { message: '대여기간 종료일이 일주일 남았습니다.\n연장이 필요한 경우 상품을 구매해주세요!', registeredDateTime: '2026.04.24 00:01' },
    ] as any);

    expect(message?.message).toBe('최근 구매자 실제 문의입니다');
  });
});
