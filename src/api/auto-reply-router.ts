import { hasRiskKeyword } from './auto-reply-policy';

export type AutoReplyCategory = 'auth_code_request' | 'pin_or_email_link' | 'login_issue' | 'profile_issue' | 'refund_or_dispute' | 'general' | 'unknown';
export type AutoReplyRisk = 'low' | 'medium' | 'high';
export type AutoReplyAction = 'template' | 'hermes_draft' | 'human_review';

export interface AutoReplyRoute {
  category: AutoReplyCategory;
  risk: AutoReplyRisk;
  action: AutoReplyAction;
  reason: string;
}

function includesAny(text: string, words: string[]): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return words.some((word) => normalized.includes(word.toLowerCase()));
}

export function routeAutoReply(message: string): AutoReplyRoute {
  if (hasRiskKeyword(message)) {
    return { category: 'refund_or_dispute', risk: 'high', action: 'human_review', reason: '위험/분쟁 키워드 감지' };
  }
  if (includesAny(message, ['인증번호', '인증 번호', '인증코드', '인증 코드', '코드', '메일', '이메일'])) {
    return { category: 'auth_code_request', risk: 'low', action: 'template', reason: '인증코드/메일 확인 요청' };
  }
  if (includesAny(message, ['pin', '핀', '이메일 확인 사이트', '확인 사이트'])) {
    return { category: 'pin_or_email_link', risk: 'low', action: 'template', reason: 'PIN 또는 이메일 확인 링크 요청' };
  }
  if (includesAny(message, ['로그인', '비밀번호', '접속', '안돼요', '안 되요', '안 됩니다'])) {
    return { category: 'login_issue', risk: 'low', action: 'hermes_draft', reason: '로그인 문제 문의' };
  }
  if (includesAny(message, ['프로필', '동시접속', '동시 접속', '이름 변경'])) {
    return { category: 'profile_issue', risk: 'medium', action: 'hermes_draft', reason: '프로필/동시접속 문의' };
  }
  if (message.trim()) {
    return { category: 'general', risk: 'medium', action: 'hermes_draft', reason: '일반 문의' };
  }
  return { category: 'unknown', risk: 'high', action: 'human_review', reason: '빈 메시지 또는 분류 불가' };
}
