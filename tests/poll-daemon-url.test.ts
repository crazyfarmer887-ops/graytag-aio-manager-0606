import { describe, expect, test } from 'vitest';
import { buildPollAfterUsingDealsUrl, buildPollDealsUrl, buildNewChatAlertCandidate, buildNewDealStatusAlerts, isPollSessionAlertEnabled } from '../src/scheduler/poll-daemon';

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

  test('alerts when a deal is first seen already delivered after a missed OnSale transition', () => {
    const { alerts, updated } = buildNewDealStatusAlerts([
      {
        productUsid: 'deal-new-delivered',
        dealStatus: 'Delivered',
        productTypeString: '티빙',
        productName: '티빙 프리미엄',
        borrowerName: '최현준',
      },
    ], {});

    expect(updated['deal-new-delivered']).toBe('Delivered');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('새 구매 발생');
    expect(alerts[0]).toContain('티빙');
    expect(alerts[0]).toContain('최현준');
    expect(alerts[0]).toContain('deal-new-delivered');
  });

  test('does not alert for first-seen OnSale rows during baseline refresh', () => {
    const { alerts, updated } = buildNewDealStatusAlerts([
      {
        productUsid: 'deal-on-sale',
        dealStatus: 'OnSale',
        productTypeString: '웨이브',
        productName: '웨이브 프리미엄',
      },
    ], {});

    expect(updated['deal-on-sale']).toBe('OnSale');
    expect(alerts).toEqual([]);
  });
});
