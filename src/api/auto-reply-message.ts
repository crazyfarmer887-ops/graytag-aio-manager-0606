export interface AutoReplyCandidateMessage {
  chatRoomUuid: string;
  dealUsid?: string;
  buyerName?: string;
  productType?: string;
  productName?: string;
  message: string;
  registeredDateTime?: string;
  createdAt?: string;
  updatedAt?: string;
  owned?: boolean;
  isOwned?: boolean;
  informationMessage?: boolean;
  isInfo?: boolean;
  messageType?: string;
}

export function normalizeBuyerMessage(input = ''): string {
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBuyerTextMessage(message: AutoReplyCandidateMessage): boolean {
  return Boolean(
    normalizeBuyerMessage(message.message || '') &&
    !message.owned &&
    !message.isOwned &&
    !message.informationMessage &&
    !message.isInfo &&
    message.messageType !== 'Information'
  );
}

export function messageTimestamp(message: AutoReplyCandidateMessage): string {
  return message.registeredDateTime || message.createdAt || message.updatedAt || '';
}

export function messageFingerprint(message: AutoReplyCandidateMessage): string {
  return `${message.chatRoomUuid}:${messageTimestamp(message)}:${normalizeBuyerMessage(message.message || '')}`;
}
