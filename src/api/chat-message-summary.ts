export interface GraytagChatMessage {
  message?: string;
  registeredDateTime?: string;
  createdAt?: string;
  updatedAt?: string;
  owned?: boolean;
  isOwned?: boolean;
  informationMessage?: boolean;
  isInfo?: boolean;
  messageType?: string;
}

function parseGraytagChatTime(value?: string): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const dotted = trimmed.match(/^(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (dotted) {
    const rawYear = Number(dotted[1]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const parsed = new Date(year, Number(dotted[2]) - 1, Number(dotted[3]), Number(dotted[4] || 0), Number(dotted[5] || 0)).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageTime(message: GraytagChatMessage): number {
  return parseGraytagChatTime(message.registeredDateTime || message.createdAt || message.updatedAt);
}

export function extractGraytagChats(response: any): GraytagChatMessage[] {
  const candidates = [
    response?.data?.data?.chats,
    response?.data?.data,
    response?.data?.chats,
    response?.data,
  ];
  const found = candidates.find((value) => Array.isArray(value));
  return found || [];
}

function isSystemNoticeMessage(message: GraytagChatMessage): boolean {
  const text = (message.message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return /계정 정보가 전달되었습니다|구매를 확정했습니다|대여기간 종료일|지급부터 사용 기간이 시작됩니다|구매확정 버튼/.test(text);
}

function isInfoMessage(message: GraytagChatMessage): boolean {
  return Boolean(message.informationMessage || message.isInfo || message.messageType === 'Information' || isSystemNoticeMessage(message));
}

function isOwnedMessage(message: GraytagChatMessage): boolean {
  return Boolean(message.owned || message.isOwned);
}

export function findLatestBuyerInquiryMessage(messages: GraytagChatMessage[]): GraytagChatMessage | undefined {
  return [...messages]
    .filter((message) => Boolean(message.message) && !isInfoMessage(message) && !isOwnedMessage(message))
    .sort((a, b) => messageTime(b) - messageTime(a))[0];
}
