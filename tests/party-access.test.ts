import { describe, expect, test } from 'vitest';
import {
  buildPartyAccessPublicPayload,
  createPartyAccessLinkRecord,
  isPartyAccessAllowed,
  normalizePartyAccessToken,
  partyAccessTokenHash,
  resolvePartyAccessCredentials,
  buildPartyAccessDeliveryTemplate,
} from '../src/lib/party-access';
import { buildPartyAccessHtml } from '../src/lib/party-access-page-html';
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

  test('public payload exposes profile name and email access link for buyer consent and email verification', () => {
    const record = createPartyAccessLinkRecord({
      token: 'profile-token', now: '2026-05-03T00:00:00.000Z', serviceType: '티빙', accountEmail: 'gtwavve7',
      fallbackPassword: 'pw', fallbackPin: '123456', profileName: '수달이', emailAccessUrl: 'https://email-verify.xyz/email/mail/42837058',
      member: { kind: 'manual', memberId: 'manual-1', memberName: '구매자', status: 'active', endDateTime: '2026-05-20' },
    });

    const payload = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-03T12:00:00.000Z');
    expect(payload.ok).toBe(true);
    expect(payload.profileName).toBe('수달이');
    expect(payload.emailAccessUrl).toBe('https://email-verify.xyz/email/mail/42837058');
  });

  test('builds the copyable manual delivery template around the party access URL', () => {
    expect(buildPartyAccessDeliveryTemplate('https://example.com/dashboard/access/token-1')).toBe(`✅ 계정 접근 주소 : https://example.com/dashboard/access/token-1 ✅

✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!! ✅
계정 정보에 필요한 모든 것은 위에 올려드린 링크를 통해 접근하실 수 있습니다. 이메일 인증은 링크 안에 적힌 핀번호를 이용해서 접근하실 수 있으십니다.

기타 문의사항은 연락 주시면 감사하겠습니다.`);
  });

  test('serves a lightweight public access shell with updated profile and email verification copy', () => {
    const html = buildPartyAccessHtml('tok<en>&1');
    expect(html).toContain('window.__PARTY_ACCESS_TOKEN__="tok\\u003cen\\u003e\\u00261"');
    expect(html).toContain('프로필을 만드실 때(혹은 프로필을 만드셨을 경우)');
    expect(html).toContain('일주일 단위로 해당 닉네임이 아닌 프로필은 삭제될 예정이니 꼭 주의 바랍니다!');
    expect(html).toContain('이메일 인증 필요시, 동의 후 나오는 이메일 인증 열기를 눌러');
    expect(html).toContain('기타 문의 연락은 구매처에서 14:00 ~ 21:00');
    expect(html).toContain('이메일 접근 PIN번호');
    expect(html).toContain('이메일 인증/핀번호 확인 링크');
    expect(html).toContain('이메일 인증 열기');
    expect(html).not.toContain('/dashboard/assets/');
  });
});
