import { describe, expect, test } from 'vitest';
import {
  buildProfileAssignment,
  buildProfileWarningMemo,
  generateProfileNickname,
  isValidProfileNickname,
  PROFILE_NICKNAME_DICTIONARY,
} from '../src/lib/profile-nickname';

describe('profile nickname assignment', () => {
  test('dictionary contains only 3-4 character animal and fruit names', () => {
    expect(PROFILE_NICKNAME_DICTIONARY.length).toBeGreaterThanOrEqual(40);
    for (const item of PROFILE_NICKNAME_DICTIONARY) {
      expect(['animal', 'fruit']).toContain(item.category);
      expect(Array.from(item.name).length).toBeGreaterThanOrEqual(3);
      expect(Array.from(item.name).length).toBeLessThanOrEqual(4);
      expect(item.name).toMatch(/^[가-힣]+$/);
    }
  });

  test('generates a stable random nickname from the dictionary', () => {
    const nickname = generateProfileNickname(() => 0);
    expect(nickname).toBe(PROFILE_NICKNAME_DICTIONARY[0].name);
    expect(Array.from(nickname).length).toBeGreaterThanOrEqual(3);
    expect(Array.from(nickname).length).toBeLessThanOrEqual(4);
  });

  test('validates manual nicknames as Korean 3-4 character names', () => {
    expect(isValidProfileNickname('고양이')).toBe(true);
    expect(isValidProfileNickname('파인애플')).toBe(true);
    expect(isValidProfileNickname('망고')).toBe(false);
    expect(isValidProfileNickname('abc')).toBe(false);
  });

  test('puts one-profile warning at the very top of account delivery memo', () => {
    const memo = buildProfileWarningMemo('수달이', '기존 안내문입니다.');
    expect(memo.startsWith('⚠️ 1인 1프로필 원칙 안내')).toBe(true);
    expect(memo).toContain('배정 프로필: 수달이');
    expect(memo).toContain('다른 프로필을 사용하거나 새 프로필을 추가하면');
    expect(memo).toContain('기존 안내문입니다.');
  });

  test('builds a tracking assignment without storing password or PIN', () => {
    const assignment = buildProfileAssignment({
      productUsids: ['p1', 'p2'],
      serviceType: '디즈니플러스',
      accountEmail: 'ott@example.com',
      emailAliasId: 123,
      emailAlias: 'alias@example.com',
      profileNickname: '망고링',
      now: '2026-04-28T00:00:00.000Z',
    });

    expect(assignment).toMatchObject({
      id: '123:망고링',
      productUsids: ['p1', 'p2'],
      serviceType: '디즈니플러스',
      accountEmail: 'ott@example.com',
      emailAliasId: 123,
      emailAlias: 'alias@example.com',
      profileNickname: '망고링',
      status: 'active',
      warningCount: 0,
      createdAt: '2026-04-28T00:00:00.000Z',
      updatedAt: '2026-04-28T00:00:00.000Z',
    });
    expect(JSON.stringify(assignment)).not.toMatch(/password|pin|passwd/i);
  });
});
