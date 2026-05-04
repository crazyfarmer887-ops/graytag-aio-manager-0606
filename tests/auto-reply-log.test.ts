import { describe, expect, test } from 'vitest';
import { autoReplyStatusLabel, autoReplyStatusTone, summarizeAutoReplyJobs } from '../src/web/lib/auto-reply-log';

describe('auto reply log UI helpers', () => {
  test('summarizes queue states for dashboard badges', () => {
    const summary = summarizeAutoReplyJobs([
      { id: '1', status: 'drafted' },
      { id: '2', status: 'drafted' },
      { id: '3', status: 'blocked' },
      { id: '4', status: 'sent' },
      { id: '5', status: 'error' },
    ] as any);
    expect(summary.drafted).toBe(2);
    expect(summary.blocked).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.error).toBe(1);
    expect(summary.total).toBe(5);
  });

  test('maps job statuses to Korean labels and safe colors', () => {
    expect(autoReplyStatusLabel('drafted')).toBe('초안 대기');
    expect(autoReplyStatusLabel('blocked')).toBe('사람 확인');
    expect(autoReplyStatusLabel('ignored')).toBe('응답 생략');
    expect(autoReplyStatusTone('sent')).toEqual({ background: '#ECFDF5', color: '#047857' });
    expect(autoReplyStatusTone('error')).toEqual({ background: '#FEF2F2', color: '#B91C1C' });
    expect(autoReplyStatusTone('ignored')).toEqual({ background: '#F3F4F6', color: '#6B7280' });
  });
});
