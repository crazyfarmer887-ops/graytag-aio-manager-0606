import { describe, expect, test } from 'vitest';
import { AUTO_REPLY_DEFAULTS, hasRiskKeyword, resolveAutoReplyPolicy } from '../src/api/auto-reply-policy';
import { isBuyerTextMessage, messageFingerprint, normalizeBuyerMessage } from '../src/api/auto-reply-message';
import { createEmptyAutoReplyState, markProcessed, shouldProcessFingerprint, pruneAutoReplyState } from '../src/api/auto-reply-store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAutoReplyJob, createEmptyAutoReplyJobStore, listAutoReplyJobs, loadAutoReplyJobStore, saveAutoReplyJobStore, updateAutoReplyJob } from '../src/api/auto-reply-jobs';
import { routeAutoReply } from '../src/api/auto-reply-router';
import { buildHermesAutoReplyPrompt, parseHermesAutoReplyJson } from '../src/api/hermes-auto-reply';
import { evaluateAutoReplySafety } from '../src/api/auto-reply-safety';
import { DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY, OFF_HOURS_NOTICE_CATEGORY, buildDailyAccountAccessNoticeReply, buildOffHoursNoticeReply, isKoreanBusinessHours, isSimpleAcknowledgement, kstDayKey, shouldSendDailyAccountAccessNotice, shouldSendOffHoursNotice } from '../src/api/auto-reply-daily-notice';

describe('auto reply core', () => {
  test('uses conservative defaults and detects risk keywords', () => {
    expect(AUTO_REPLY_DEFAULTS.enabled).toBe(false);
    expect(AUTO_REPLY_DEFAULTS.draftOnly).toBe(true);
    expect(AUTO_REPLY_DEFAULTS.autoSendAuthCode).toBe(false);
    expect(hasRiskKeyword('환불해주세요 신고할게요')).toBe(true);
    expect(hasRiskKeyword('인증번호 알려주세요')).toBe(false);
    expect(resolveAutoReplyPolicy({ enabled: true }).draftOnly).toBe(true);
  });

  test('normalizes buyer messages and filters seller/system messages', () => {
    expect(normalizeBuyerMessage('<b>인증</b><br> 번호&nbsp;주세요')).toBe('인증 번호 주세요');
    expect(isBuyerTextMessage({ chatRoomUuid: 'r1', message: '문의', isOwned: false })).toBe(true);
    expect(isBuyerTextMessage({ chatRoomUuid: 'r1', message: '판매자', isOwned: true })).toBe(false);
    expect(isBuyerTextMessage({ chatRoomUuid: 'r1', message: '입장', messageType: 'Information' })).toBe(false);
  });

  test('creates stable fingerprints from room timestamp and normalized text', () => {
    const a = messageFingerprint({ chatRoomUuid: 'room', message: '<b>코드</b><br>주세요', registeredDateTime: '2026-04-28T01:00:00Z' });
    const b = messageFingerprint({ chatRoomUuid: 'room', message: '코드 주세요', registeredDateTime: '2026-04-28T01:00:00Z' });
    expect(a).toBe(b);
    expect(a).toContain('room:2026-04-28T01:00:00Z:코드 주세요');
  });

  test('processed store rejects duplicates and prunes old entries', () => {
    const state = createEmptyAutoReplyState();
    expect(shouldProcessFingerprint(state, 'fp1')).toBe(true);
    markProcessed(state, 'fp1', { chatRoomUuid: 'room1', status: 'queued', now: '2026-04-28T00:00:00Z' });
    expect(shouldProcessFingerprint(state, 'fp1')).toBe(false);

    markProcessed(state, 'old', { chatRoomUuid: 'room2', status: 'sent', now: '2026-04-01T00:00:00Z' });
    pruneAutoReplyState(state, new Date('2026-04-28T00:00:00Z'), 14);
    expect(state.processedFingerprints.old).toBeUndefined();
    expect(state.processedFingerprints.fp1).toBeDefined();
  });

  test('job store creates updates and lists newest jobs first', () => {
    const store = createEmptyAutoReplyJobStore();
    const first = createAutoReplyJob(store, {
      fingerprint: 'fp1', chatRoomUuid: 'room1', buyerMessage: '로그인이 안돼요', createdAt: '2026-04-28T00:00:00Z'
    });
    const second = createAutoReplyJob(store, {
      fingerprint: 'fp2', chatRoomUuid: 'room2', buyerMessage: '코드 주세요', createdAt: '2026-04-28T00:01:00Z'
    });
    updateAutoReplyJob(store, first.id, { status: 'drafted', draftReply: '확인해드릴게요' }, '2026-04-28T00:02:00Z');
    expect(store.jobs[first.id].status).toBe('drafted');
    expect(listAutoReplyJobs(store).map((job) => job.id)).toEqual([second.id, first.id]);
  });

  test('persists job store to a JSON file and rebuilds fingerprint index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'auto-reply-jobs-'));
    const file = join(dir, 'jobs.json');
    try {
      const store = createEmptyAutoReplyJobStore();
      const job = createAutoReplyJob(store, {
        fingerprint: 'persist-fp', chatRoomUuid: 'persist-room', buyerMessage: '로그인이 안돼요', createdAt: '2026-04-28T00:00:00Z'
      });
      updateAutoReplyJob(store, job.id, { status: 'drafted', draftReply: '확인해드릴게요' }, '2026-04-28T00:02:00Z');
      saveAutoReplyJobStore(file, store);

      const loaded = loadAutoReplyJobStore(file);
      expect(loaded.jobs[job.id].draftReply).toBe('확인해드릴게요');
      expect(loaded.fingerprintToJobId['persist-fp']).toBe(job.id);
      expect(createAutoReplyJob(loaded, {
        fingerprint: 'persist-fp', chatRoomUuid: 'persist-room', buyerMessage: '다시', createdAt: '2026-04-28T00:03:00Z'
      }).id).toBe(job.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('routes messages before Hermes is called', () => {
    expect(routeAutoReply('인증번호 코드 메일 확인 부탁').action).toBe('template');
    expect(routeAutoReply('로그인이 안돼요').action).toBe('hermes_draft');
    const dispute = routeAutoReply('환불 안 해주면 신고할게요');
    expect(dispute.action).toBe('human_review');
    expect(dispute.risk).toBe('high');
  });

  test('builds strict Hermes prompt and parses JSON safely', () => {
    const prompt = buildHermesAutoReplyPrompt({
      buyerMessage: '로그인이 안돼요', buyerName: '민수', productType: '넷플릭스', productName: '넷플릭스 프리미엄'
    });
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('로그인이 안돼요');
    expect(prompt).not.toContain('JSESSIONID');

    expect(parseHermesAutoReplyJson(' { "category":"login_issue", "risk":"low", "autoSendAllowed":false, "reply":"안내", "reason":"초안", "needsHuman":false } ').reply).toBe('안내');
    expect(() => parseHermesAutoReplyJson('not json')).toThrow(/Invalid Hermes auto-reply JSON/);
  });

  test('builds daily account-link and off-hours notices with KST day reset', () => {
    const store = createEmptyAutoReplyJobStore();
    const kst1500 = new Date('2026-05-04T06:00:00Z');
    const kst2130 = new Date('2026-05-04T12:30:00Z');
    expect(kstDayKey(kst1500)).toBe('2026-05-04');
    expect(isKoreanBusinessHours(kst1500)).toBe(true);
    expect(isKoreanBusinessHours(kst2130)).toBe(false);
    expect(shouldSendDailyAccountAccessNotice(store, 'room-daily', kst1500)).toBe(true);
    expect(buildDailyAccountAccessNoticeReply('https://email-verify.xyz/dashboard/access/token')).toContain('업데이트된 정보로 로그인을 시도');
    expect(buildDailyAccountAccessNoticeReply('https://email-verify.xyz/dashboard/access/token')).toContain('https://email-verify.xyz/dashboard/access/token');
    expect(buildOffHoursNoticeReply()).toBe('문의 시간은 14:00 ~ 21:00 라서, 최대한 빨리 답변드리도록 하겠습니다.');

    const first = createAutoReplyJob(store, { fingerprint: 'daily-fp', chatRoomUuid: 'room-daily', buyerMessage: '로그인 문의', createdAt: '2026-05-04T06:00:00Z' });
    updateAutoReplyJob(store, first.id, { status: 'sent', category: DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY, draftReply: 'notice' }, '2026-05-04T06:00:01Z');
    expect(shouldSendDailyAccountAccessNotice(store, 'room-daily', kst1500)).toBe(false);
    expect(shouldSendDailyAccountAccessNotice(store, 'room-daily', new Date('2026-05-05T05:00:00Z'))).toBe(true);

    const off = createAutoReplyJob(store, { fingerprint: 'off-fp', chatRoomUuid: 'room-daily', buyerMessage: '문의', createdAt: '2026-05-04T12:31:00Z' });
    updateAutoReplyJob(store, off.id, { status: 'sent', category: OFF_HOURS_NOTICE_CATEGORY, draftReply: 'off' }, '2026-05-04T12:31:01Z');
    expect(shouldSendOffHoursNotice(store, 'room-daily', kst2130)).toBe(false);
  });

  test('recognizes short acknowledgement replies after the daily notice', () => {
    expect(isSimpleAcknowledgement('네 감사합니다')).toBe(true);
    expect(isSimpleAcknowledgement('확인했습니다')).toBe(true);
    expect(isSimpleAcknowledgement('아직 로그인이 안돼요')).toBe(false);
  });

  test('safety gate blocks risky or draft-only sends', () => {
    const base = {
      policy: resolveAutoReplyPolicy({ enabled: true, draftOnly: true }),
      route: routeAutoReply('로그인이 안돼요'),
      hermes: { category: 'login_issue', risk: 'low' as const, autoSendAllowed: true, reply: '안내드릴게요', reason: 'ok', needsHuman: false },
      recentRoomReplyTimes: [] as string[],
      now: new Date('2026-04-28T00:00:00Z'),
      safeModeEnabled: false,
    };
    expect(evaluateAutoReplySafety(base).allowed).toBe(false);
    expect(evaluateAutoReplySafety({ ...base, policy: resolveAutoReplyPolicy({ enabled: true, draftOnly: false, autoSendLowRisk: true }) }).allowed).toBe(true);
    expect(evaluateAutoReplySafety({ ...base, policy: resolveAutoReplyPolicy({ enabled: true, draftOnly: false, autoSendLowRisk: true }), safeModeEnabled: true }).allowed).toBe(false);
    expect(evaluateAutoReplySafety({ ...base, policy: resolveAutoReplyPolicy({ enabled: true, draftOnly: false, autoSendLowRisk: true }), hermes: { ...base.hermes, reply: '환불 해드릴게요' } }).allowed).toBe(false);
  });
});
