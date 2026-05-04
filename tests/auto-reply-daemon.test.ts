import { describe, expect, test } from 'vitest';
import { autoReplyDaemonEnabled, autoReplyDaemonIntervalMs } from '../src/scheduler/auto-reply-daemon';

describe('auto reply daemon config', () => {
  test('is disabled by default and clamps interval', () => {
    expect(autoReplyDaemonEnabled({})).toBe(false);
    expect(autoReplyDaemonEnabled({ AUTO_REPLY_DAEMON_ENABLED: 'true' })).toBe(true);
    expect(autoReplyDaemonIntervalMs({})).toBe(600000);
    expect(autoReplyDaemonIntervalMs({ AUTO_REPLY_DAEMON_INTERVAL_MS: '1000' })).toBe(10000);
    expect(autoReplyDaemonIntervalMs({ AUTO_REPLY_DAEMON_INTERVAL_MS: '45000' })).toBe(45000);
  });
});
