export interface AutoReplyPolicy {
  enabled: boolean;
  draftOnly: boolean;
  autoSendAuthCode: boolean;
  autoSendLowRisk: boolean;
  maxAutoRepliesPerRoomPer10Min: number;
  minSecondsBetweenRepliesPerRoom: number;
  maxMessageCharsForAi: number;
  riskKeywords: string[];
}

export const DEFAULT_RISK_KEYWORDS = [
  '환불', '취소', '신고', '경찰', '사기', '고소', '먹튀',
  '돈 돌려', '짜증', '화남', '안됨', '안 돼', '계정 정지', '차단',
];

export const AUTO_REPLY_DEFAULTS: AutoReplyPolicy = {
  enabled: false,
  draftOnly: true,
  autoSendAuthCode: false,
  autoSendLowRisk: false,
  maxAutoRepliesPerRoomPer10Min: 2,
  minSecondsBetweenRepliesPerRoom: 60,
  maxMessageCharsForAi: 1000,
  riskKeywords: DEFAULT_RISK_KEYWORDS,
};

export function resolveAutoReplyPolicy(overrides: Partial<AutoReplyPolicy> = {}): AutoReplyPolicy {
  return {
    ...AUTO_REPLY_DEFAULTS,
    ...overrides,
    riskKeywords: overrides.riskKeywords ?? AUTO_REPLY_DEFAULTS.riskKeywords,
  };
}

export function hasRiskKeyword(text: string, keywords = AUTO_REPLY_DEFAULTS.riskKeywords): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}
