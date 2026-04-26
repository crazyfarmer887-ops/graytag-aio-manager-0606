import { describe, expect, test } from 'vitest';
import { buildPollDealsUrl } from '../src/scheduler/poll-daemon';

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
});
