import { describe, expect, test } from 'vitest';
import {
  buildOperationsCenter,
  createManualResponseQueueItem,
  mergeManualResponseQueueItem,
  summarizeManualResponseQueue,
  type ManualResponseQueueItem,
} from '../src/lib/operations-center';

const now = '2026-05-02T00:00:00.000Z';

describe('operations center helper', () => {
  test('creates Kakao/manual response items with safe defaults and no secrets', () => {
    const item = createManualResponseQueueItem({
      source: '카카오톡',
      buyerName: '김고객',
      serviceType: '넷플릭스',
      accountEmail: 'netflix@example.com',
      message: '입금했어요 확인 부탁드려요',
      now,
    });

    expect(item.id).toMatch(/^mrq_/);
    expect(item.status).toBe('todo');
    expect(item.priority).toBe('normal');
    expect(item.source).toBe('카카오톡');
    expect(item.createdAt).toBe(now);
    expect(JSON.stringify(item)).not.toMatch(/password|passwd|pin|cookie|token/i);
  });

  test('merges status updates while clearing stale completion fields', () => {
    const item = createManualResponseQueueItem({ source: '수동고객', buyerName: '박고객', message: '연장 문의', now });
    const done = mergeManualResponseQueueItem(item, { status: 'done', memo: '답변 완료' }, '2026-05-02T01:00:00.000Z');
    const reopened = mergeManualResponseQueueItem(done, { status: 'todo' }, '2026-05-02T02:00:00.000Z');

    expect(done.doneAt).toBe('2026-05-02T01:00:00.000Z');
    expect(reopened.doneAt).toBeNull();
    expect(reopened.memo).toBe('답변 완료');
  });

  test('summarizes manual queue by actionable state and Kakao source', () => {
    const items: ManualResponseQueueItem[] = [
      createManualResponseQueueItem({ source: '카카오톡', buyerName: 'A', message: 'A', now }),
      createManualResponseQueueItem({ source: '수동고객', buyerName: 'B', message: 'B', now, status: 'in_progress' }),
      createManualResponseQueueItem({ source: '카카오톡', buyerName: 'C', message: 'C', now, status: 'done' }),
    ];

    expect(summarizeManualResponseQueue(items)).toMatchObject({ total: 3, open: 2, kakaoOpen: 1, done: 1 });
  });

  test('builds operations center summary across profile audit, auto-reply, and manual queues', () => {
    const center = buildOperationsCenter({
      profileAuditRows: [
        { status: 'match' },
        { status: 'mismatch' },
        { status: 'unchecked' },
      ],
      autoReplyJobs: [
        { status: 'drafted' },
        { status: 'blocked' },
        { status: 'sent' },
      ],
      manualQueueItems: [
        createManualResponseQueueItem({ source: '카카오톡', buyerName: 'A', message: 'A', now }),
        createManualResponseQueueItem({ source: '수동고객', buyerName: 'B', message: 'B', now, status: 'done' }),
      ],
    });

    expect(center.summary.actionRequired).toBe(5);
    expect(center.summary.profileIssues).toBe(2);
    expect(center.summary.replyQueueOpen).toBe(1);
    expect(center.summary.autoReplyNeedsReview).toBe(2);
    expect(center.recommendedActions[0].label).toMatch(/프로필/);
  });
});
