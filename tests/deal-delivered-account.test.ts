import { describe, expect, test } from 'vitest';
import { extractDeliveredAccountFromChats, isAccountCheckPendingDeal, shouldHydrateDeliveredAccountFromChat } from '../src/lib/deal-delivered-account';

describe('deal delivered account hydration', () => {
  test('targets account-check pending deals with a chat room and missing keepAcct', () => {
    expect(shouldHydrateDeliveredAccountFromChat({ dealStatus: 'DeliveredAndCheckPrepaid', chatRoomUuid: 'room-1', keepAcct: '' })).toBe(true);
    expect(shouldHydrateDeliveredAccountFromChat({ lenderDealStatusName: '계정확인중', chatRoomUuid: 'room-1', keepAcct: null })).toBe(true);
    expect(shouldHydrateDeliveredAccountFromChat({ dealStatus: 'DeliveredAndCheckPrepaid', chatRoomUuid: 'room-1', keepAcct: 'already@example.com' })).toBe(false);
  });

  test('extracts the account id that the seller delivered in chat without exposing passwords or PINs', () => {
    const account = extractDeliveredAccountFromChats([
      { owned: false, informationMessage: false, message: '구매자 문의입니다' },
      { owned: true, informationMessage: false, message: '⚠️ 안내<br>아이디 : wavve12&#64;example.com<br>비밀번호 : Secret123!<br>PIN : 123456' },
    ]);

    expect(account).toBe('wavve12@example.com');
  });

  test('supports TVING login id wording and ignores buyer/system messages', () => {
    const account = extractDeliveredAccountFromChats([
      { owned: true, informationMessage: true, message: '채팅방에 입장했습니다' },
      { owned: false, informationMessage: false, message: '아이디: buyer-typed-id' },
      { owned: true, informationMessage: false, message: '티빙 로그인 ID는 gtwavve44 입니다. 프로필 이름은 수달이로 해주세요.' },
    ]);

    expect(account).toBe('gtwavve44');
  });

  test('recognizes Korean account-check status names as pending', () => {
    expect(isAccountCheckPendingDeal({ lenderDealStatusName: '계정확인중' })).toBe(true);
    expect(isAccountCheckPendingDeal({ lenderDealStatusName: '계정 확인 중' })).toBe(true);
    expect(isAccountCheckPendingDeal({ lenderDealStatusName: '이용중' })).toBe(false);
  });
});
