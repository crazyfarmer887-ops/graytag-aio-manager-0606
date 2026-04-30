export interface DeliveredAccountChatLike {
  message?: string | null;
  owned?: boolean;
  isOwned?: boolean;
  informationMessage?: boolean;
  messageType?: string;
}

export interface AccountCheckDealLike {
  dealStatus?: string | null;
  lenderDealStatusName?: string | null;
  chatRoomUuid?: string | null;
  keepAcct?: string | null;
}

export function normalizeGraytagChatText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/&#64;|&commat;/gi, '@')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>\s*/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function isAccountCheckPendingDeal(deal: AccountCheckDealLike): boolean {
  const status = String(deal.dealStatus || '').trim();
  const statusName = String(deal.lenderDealStatusName || '').replace(/\s+/g, '').trim();
  return status === 'DeliveredAndCheckPrepaid' || statusName.includes('계정확인중');
}

export function shouldHydrateDeliveredAccountFromChat(deal: AccountCheckDealLike): boolean {
  return isAccountCheckPendingDeal(deal) && Boolean(String(deal.chatRoomUuid || '').trim()) && !String(deal.keepAcct || '').trim();
}

function cleanAccountCandidate(value: string): string {
  return value
    .replace(/^[\s:：=\-]+/, '')
    .replace(/[\s,，。.!！?？)\]}>'"`]+$/g, '')
    .trim();
}

function isPlausibleAccountCandidate(value: string): boolean {
  if (!value) return false;
  if (value.length < 3 || value.length > 120) return false;
  if (/비밀번호|패스워드|password|pin|인증|프로필|이름/i.test(value)) return false;
  return /^[A-Za-z0-9._%+@\-]+$/.test(value);
}

export function extractDeliveredAccountFromText(text: string): string | null {
  const normalized = normalizeGraytagChatText(text);
  const patterns = [
    /(?:아이디|ID|Id|id|로그인\s*ID|로그인\s*아이디|계정)\s*(?:는|은)?\s*[:：=]?\s*([A-Za-z0-9._%+@\-]{3,120})/i,
    /(?:email|e-mail|이메일)\s*(?:주소)?\s*[:：=]?\s*([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const candidate = cleanAccountCandidate(match[1] || '');
    if (isPlausibleAccountCandidate(candidate)) return candidate;
  }
  return null;
}

export function extractDeliveredAccountFromChats(messages: DeliveredAccountChatLike[]): string | null {
  for (const msg of messages) {
    const owned = msg.owned ?? msg.isOwned ?? false;
    const information = msg.informationMessage || msg.messageType === 'Information';
    if (!owned || information) continue;
    const account = extractDeliveredAccountFromText(String(msg.message || ''));
    if (account) return account;
  }
  return null;
}
