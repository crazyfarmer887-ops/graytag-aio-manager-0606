import { describe, expect, test } from 'vitest';
import { buildPollAfterUsingDealsUrl, buildPollDealsUrl, buildNewChatAlertCandidate, isPollSessionAlertEnabled } from '../src/scheduler/poll-daemon';

describe('PollDaemon Graytag deal list URL', () => {
  test('uses the finished-included selling list that matches the updated 판매내역 toggle behavior', () => {
    const url = buildPollDealsUrl();

    expect(url).toContain('/ws/lender/findBeforeUsingLenderDeals');
    expect(url).toContain('finishedDealIncluded=true');
    expect(url).not.toContain('finishedDealIncluded=false');
    expect(url).toContain('sorting=Latest');
    expect(url).toContain('page=1');
    expect(url).toContain('rows=50');
  });

  test('also polls active deals so unread Graytag chats can trigger Telegram alerts', () => {
    const url = buildPollAfterUsingDealsUrl();
    expect(url).toContain('/ws/lender/findAfterUsingLenderDeals');
    expect(url).toContain('finishedDealIncluded=false');
    expect(url).toContain('rows=50');
  });

  test('can disable only stale/missing session-cookie PollDaemon alerts by env', () => {
    expect(isPollSessionAlertEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isPollSessionAlertEnabled({ POLL_SESSION_ALERTS_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPollSessionAlertEnabled({ POLL_SESSION_ALERTS_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPollSessionAlertEnabled({ POLL_SESSION_ALERTS_ENABLED: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  test('builds one Telegram chat alert fingerprint per new buyer message and dedupes known messages', () => {
    const deal = {
      dealUsid: 'deal-1',
      chatRoomUuid: 'room-1',
      borrowerName: '홍길동',
      productTypeString: '넷플릭스',
      productName: '넷플릭스 3개월',
      keepAcct: 'netflix@example.com',
    };
    const message = {
      message: '<b>비밀번호</b><br>재설정 문자 왔나요?',
      registeredDateTime: '2026-05-01T12:00:00Z',
      owned: false,
      informationMessage: false,
    };

    const alert = buildNewChatAlertCandidate(deal, message, {});
    expect(alert).toMatchObject({
      chatRoomUuid: 'room-1',
      dealUsid: 'deal-1',
      borrowerName: '홍길동',
      productType: '넷플릭스',
      keepAcct: 'netflix@example.com',
      text: '비밀번호 재설정 문자 왔나요?',
      timestamp: '2026-05-01T12:00:00Z',
    });
    expect(buildNewChatAlertCandidate(deal, message, { [alert!.fingerprint]: alert!.timestamp })).toBeNull();
  });
});
