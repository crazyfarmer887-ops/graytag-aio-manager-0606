import { hasRiskKeyword, type AutoReplyPolicy } from './auto-reply-policy';
import type { AutoReplyRoute } from './auto-reply-router';
import type { HermesAutoReplyResult } from './hermes-auto-reply';

export interface AutoReplySafetyInput {
  policy: AutoReplyPolicy;
  route: AutoReplyRoute;
  hermes: HermesAutoReplyResult;
  recentRoomReplyTimes: string[];
  now: Date;
  safeModeEnabled: boolean;
}

export interface AutoReplySafetyDecision {
  allowed: boolean;
  reason: string;
}

export function evaluateAutoReplySafety(input: AutoReplySafetyInput): AutoReplySafetyDecision {
  if (!input.policy.enabled) return { allowed: false, reason: '자동응답이 꺼져 있음' };
  if (input.safeModeEnabled) return { allowed: false, reason: '안전 모드가 켜져 있음' };
  if (input.policy.draftOnly) return { allowed: false, reason: '초안 모드' };
  if (input.route.action === 'human_review' || input.route.risk === 'high') return { allowed: false, reason: '사람 확인 필요' };
  if (input.hermes.needsHuman) return { allowed: false, reason: 'Hermes가 사람 확인 필요로 판단' };
  if (!input.hermes.autoSendAllowed) return { allowed: false, reason: 'Hermes 자동발송 미허용' };
  const reply = input.hermes.reply.trim();
  if (!reply) return { allowed: false, reason: '답변이 비어 있음' };
  if (reply.length > 500) return { allowed: false, reason: '답변이 너무 김' };
  if (hasRiskKeyword(reply)) return { allowed: false, reason: '답변에 위험 키워드 포함' };

  const nowMs = input.now.getTime();
  const recent = input.recentRoomReplyTimes
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const within10Min = recent.filter((value) => nowMs - value <= 10 * 60 * 1000);
  if (within10Min.length >= input.policy.maxAutoRepliesPerRoomPer10Min) return { allowed: false, reason: '방별 자동응답 횟수 제한' };
  const latest = Math.max(0, ...recent);
  if (latest && nowMs - latest < input.policy.minSecondsBetweenRepliesPerRoom * 1000) return { allowed: false, reason: '방별 자동응답 간격 제한' };

  if (input.route.category === 'auth_code_request' && !input.policy.autoSendAuthCode) return { allowed: false, reason: '인증코드 자동발송 꺼져 있음' };
  if (input.route.category !== 'auth_code_request' && !input.policy.autoSendLowRisk) return { allowed: false, reason: '일반 문의 자동발송 꺼져 있음' };
  return { allowed: true, reason: '자동발송 허용' };
}
