import { describe, expect, test } from 'vitest';
import { decideAutonomousReply } from '../src/api/auto-reply-autonomy';
import { routeAutoReply } from '../src/api/auto-reply-router';

describe('auto reply autonomy decision', () => {
  test('auto-sends verification codes when code lookup succeeds', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '인증번호 주세요',
      route: routeAutoReply('인증번호 주세요'),
      authCode: '123456',
    });
    expect(decision.kind).toBe('auto_send');
    expect(decision.reply).toContain('123456');
    expect(decision.notifyHuman).toBe(false);
  });

  test('sends receipt and notifies human when verification code lookup fails', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '코드 주세요',
      route: routeAutoReply('코드 주세요'),
      authCode: null,
      failureReason: 'alias not found',
    });
    expect(decision.kind).toBe('receipt_and_alert');
    expect(decision.reply).toContain('확인');
    expect(decision.notifyHuman).toBe(true);
  });

  test('auto-sends confident Hermes usage replies', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '로그인이 안돼요',
      route: routeAutoReply('로그인이 안돼요'),
      hermes: { category: 'login_issue', risk: 'low', confidence: 0.91, autoSendAllowed: true, reply: '공백 없이 다시 입력해 주세요.', reason: 'login', needsHuman: false },
    });
    expect(decision.kind).toBe('auto_send');
    expect(decision.reply).toBe('공백 없이 다시 입력해 주세요.');
  });

  test('keeps Hermes draft when confidence is omitted instead of replacing it with a generic question', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '프로필 자리가 꽉 찼어요',
      route: routeAutoReply('프로필 자리가 꽉 찼어요'),
      hermes: { category: 'profile_issue', risk: 'medium', autoSendAllowed: false, reply: '기본 프로필이 보이면 그 프로필을 수정해서 사용해 주세요. 없으면 확인해드릴게요.', reason: 'profile', needsHuman: false },
    });
    expect(decision.kind).toBe('draft_only');
    expect(decision.reply).toContain('기본 프로필');
  });

  test('asks a clarifying question for ambiguous messages without human alert', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '안돼요',
      route: { category: 'unknown', risk: 'medium', action: 'hermes_draft', reason: 'ambiguous' },
      hermes: { category: 'unknown', risk: 'medium', confidence: 0.5, autoSendAllowed: false, reply: '', reason: 'ambiguous', needsHuman: false },
    });
    expect(decision.kind).toBe('clarifying_question');
    expect(decision.reply).toContain('어느 단계');
    expect(decision.notifyHuman).toBe(false);
  });

  test('keeps Hermes draft for short but clear acknowledgement messages', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '네 감사합니다',
      route: routeAutoReply('네 감사합니다'),
      hermes: { category: 'general', risk: 'low', autoSendAllowed: false, reply: '감사합니다. 즐거운 시청 되세요!', reason: 'thanks', needsHuman: false },
    });
    expect(decision.kind).toBe('draft_only');
    expect(decision.reply).toContain('즐거운 시청');
  });

  test('dangerous messages get receipt reply and human alert', () => {
    const decision = decideAutonomousReply({
      buyerMessage: '환불 안 해주면 신고할게요',
      route: routeAutoReply('환불 안 해주면 신고할게요'),
    });
    expect(decision.kind).toBe('receipt_and_alert');
    expect(decision.notifyHuman).toBe(true);
    expect(decision.humanReason).toContain('위험');
  });
});
