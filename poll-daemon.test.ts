import { describe, expect, it } from 'vitest';
import { isPollSessionFresh } from './src/scheduler/poll-daemon.ts';

describe('PollDaemon stale session threshold', () => {
  it('treats missing or too-old cookie mtimes as stale', () => {
    expect(isPollSessionFresh(null, 60_000, 1_000_000)).toBe(false);
    expect(isPollSessionFresh(900_000, 60_000, 1_000_000)).toBe(false);
  });

  it('allows fresh cookie mtimes inside the threshold', () => {
    expect(isPollSessionFresh(970_001, 60_000, 1_000_000)).toBe(true);
  });
});
