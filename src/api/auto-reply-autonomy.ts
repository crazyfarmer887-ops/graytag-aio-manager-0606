import type { AutoReplyRoute } from './auto-reply-router';
import type { HermesAutoReplyResult } from './hermes-auto-reply';

export type AutonomousReplyKind = 'auto_send' | 'clarifying_question' | 'receipt_and_alert' | 'draft_only';

export interface AutonomousReplyDecision {
  kind: AutonomousReplyKind;
  reply: string;
  notifyHuman: boolean;
  humanReason?: string;
}

export interface AutonomousReplyInput {
  buyerMessage: string;
  route: AutoReplyRoute;
  hermes?: HermesAutoReplyResult & { confidence?: number };
  authCode?: string | null;
  failureReason?: string;
}

export function defaultReceiptReply(): string {
  return '불편드려 죄송합니다. 해당 내용은 정확한 확인이 필요해서 확인 후 안내드리겠습니다. 조금만 기다려주세요.';
}

export function defaultClarifyingQuestion(): string {
  return '어느 단계에서 안 되는지 확인 도와드릴게요. 로그인 전, 인증코드 입력, 프로필 선택, 재생 오류 중 어떤 상황인지 알려주세요.';
}

export function decideAutonomousReply(input: AutonomousReplyInput): AutonomousReplyDecision {
  const route = input.route;
  if (route.action === 'human_review' || route.risk === 'high') {
    return { kind: 'receipt_and_alert', reply: defaultReceiptReply(), notifyHuman: true, humanReason: `위험/사람확인 필요: ${route.reason}` };
  }

  if (route.category === 'auth_code_request' || route.category === 'pin_or_email_link') {
    if (input.authCode) {
      return {
        kind: 'auto_send',
        reply: `확인된 인증코드는 ${input.authCode} 입니다. 만료되었으면 다시 요청해 주세요.`,
        notifyHuman: false,
      };
    }
    return {
      kind: 'receipt_and_alert',
      reply: '인증코드 확인 도와드릴게요. 현재 바로 확인이 필요해서 확인 후 안내드리겠습니다. 조금만 기다려주세요.',
      notifyHuman: true,
      humanReason: `인증코드 자동조회 실패${input.failureReason ? `: ${input.failureReason}` : ''}`,
    };
  }

  const confidence = input.hermes?.confidence;
  if (input.hermes?.reply && input.hermes.autoSendAllowed && !input.hermes.needsHuman && input.hermes.risk === 'low' && (confidence ?? 0) >= 0.85) {
    return { kind: 'auto_send', reply: input.hermes.reply, notifyHuman: false };
  }

  const shortMessage = input.buyerMessage.replace(/\s+/g, '').length <= 8;
  if (route.category === 'unknown' || (shortMessage && !input.hermes?.reply)) {
    return { kind: 'clarifying_question', reply: defaultClarifyingQuestion(), notifyHuman: false };
  }

  if (input.hermes?.reply) {
    return { kind: 'draft_only', reply: input.hermes.reply, notifyHuman: false, humanReason: confidence !== undefined && confidence < 0.65 ? '자동발송 신뢰도 부족' : 'Hermes 초안 검토 필요' };
  }

  return { kind: 'clarifying_question', reply: defaultClarifyingQuestion(), notifyHuman: false };
}
