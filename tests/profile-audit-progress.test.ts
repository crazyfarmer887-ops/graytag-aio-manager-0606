import { describe, expect, test } from 'vitest';
import { createProfileAuditProgress, finishProfileAuditProgress, updateProfileAuditProgress } from '../src/api/profile-audit';

describe('profile audit progress', () => {
  test('tracks current account and percent while rows are checked', () => {
    const progress = createProfileAuditProgress(4);
    expect(progress).toMatchObject({ status: 'running', total: 4, completed: 0, percent: 0 });

    const updated = updateProfileAuditProgress(progress, {
      completed: 2,
      currentServiceType: '넷플릭스',
      currentAccountEmail: 'netflix@example.com',
      message: '넷플릭스 검사 중',
    });

    expect(updated).toMatchObject({
      status: 'running',
      total: 4,
      completed: 2,
      percent: 50,
      currentServiceType: '넷플릭스',
      currentAccountEmail: 'netflix@example.com',
      message: '넷플릭스 검사 중',
    });
  });

  test('marks progress as completed or failed with bounded percent', () => {
    const progress = createProfileAuditProgress(3);
    updateProfileAuditProgress(progress, { completed: 7 });
    expect(progress.percent).toBe(100);

    finishProfileAuditProgress(progress, 'completed');
    expect(progress).toMatchObject({ status: 'completed', completed: 3, percent: 100 });
  });
});
