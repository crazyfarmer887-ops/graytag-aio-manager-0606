import { describe, expect, test } from 'vitest';
import {
  buildPartyAccessPublicPayload,
  createPartyAccessLinkRecord,
  isPartyAccessAllowed,
  normalizePartyAccessToken,
  partyAccessTokenHash,
  resolvePartyAccessCredentials,
} from '../src/lib/party-access';
import { mergePartyMaintenanceChecklistState } from '../src/lib/party-maintenance-checklist';

describe('party member account access links', () => {
  test('creates a token-hashed link record without storing the raw token', () => {
    const token = '  AbC-123_secret  ';
    const record = createPartyAccessLinkRecord({
      token,
      now: '2026-05-03T00:00:00.000Z',
      serviceType: '디즈니플러스',
      accountEmail: 'party@example.com',
      fallbackPassword: 'old-pass',
      fallbackPin: '111222',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '남은사람', status: 'Using', endDateTime: '2026-05-20' },
    });

    expect(normalizePartyAccessToken(token)).toBe('AbC-123_secret');
    expect(record.tokenHash).toBe(partyAccessTokenHash('AbC-123_secret'));
    expect(JSON.stringify(record)).not.toContain('AbC-123_secret');
    expect(record.serviceType).toBe('디즈니플러스');
    expect(record.member.memberId).toBe('deal-1');
  });

  test('allows current party members and blocks ended or revoked members in real time by date/status', () => {
    const active = createPartyAccessLinkRecord({
      token: 'active-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-active', memberName: '활성', status: 'Using', endDateTime: '2026-05-04' },
    });
    const ended = createPartyAccessLinkRecord({
      token: 'ended-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-ended', memberName: '종료', status: 'Using', endDateTime: '2026-05-02' },
    });
    const cancelled = createPartyAccessLinkRecord({
      token: 'cancel-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'manual', memberId: 'manual-1', memberName: '취소', status: 'cancelled', endDateTime: '2026-05-20' },
    });
    const revoked = { ...active, revokedAt: '2026-05-03T01:00:00.000Z' };

    expect(isPartyAccessAllowed(active, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: true });
    expect(isPartyAccessAllowed(ended, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'expired' });
    expect(isPartyAccessAllowed(cancelled, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'ended-status' });
    expect(isPartyAccessAllowed(revoked, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'revoked' });
  });

  test('returns latest checklist password and PIN over stale link fallback credentials', () => {
    const record = createPartyAccessLinkRecord({
      token: 'credential-token', now: '2026-05-03T00:00:00.000Z', serviceType: '디즈니플러스', accountEmail: 'party@example.com',
      fallbackPassword: 'old-pass', fallbackPin: '111222',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '남은사람', status: 'Using', endDateTime: '2026-05-20' },
    });
    const key = '디즈니플러스:party@example.com';
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: true,
      passwordChanged: true,
      changedPassword: 'latest-pass',
      pinStillUnchanged: false,
      generatedPin: '654321',
      generatedPinAliasId: 123,
    }, 'tester');

    expect(resolvePartyAccessCredentials(record, store, {})).toEqual({
      id: 'party@example.com',
      password: 'latest-pass',
      pin: '654321',
      updatedAt: store[key].updatedAt,
    });
  });

  test('public payload never includes credentials for blocked members and logs allowed view metadata', () => {
    const record = createPartyAccessLinkRecord({
      token: 'payload-token', now: '2026-05-03T00:00:00.000Z', serviceType: '웨이브', accountEmail: 'w@example.com',
      fallbackPassword: 'pw', fallbackPin: '222333',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '남은사람', status: 'Using', endDateTime: '2026-05-20' },
    });
    const allowed = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-03T12:00:00.000Z');
    expect(allowed.ok).toBe(true);
    expect(allowed.credentials).toMatchObject({ id: 'w@example.com', password: 'pw', pin: '222333' });
    expect(allowed.audit).toMatchObject({ memberId: 'deal-1', allowed: true });

    const blocked = buildPartyAccessPublicPayload({ ...record, revokedAt: '2026-05-03T13:00:00.000Z' }, {}, {}, '2026-05-03T14:00:00.000Z');
    expect(blocked.ok).toBe(false);
    expect(blocked.credentials).toBeUndefined();
    expect(blocked.audit).toMatchObject({ memberId: 'deal-1', allowed: false, reason: 'revoked' });
  });
});
