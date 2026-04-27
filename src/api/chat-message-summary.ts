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

function isInfoMessage(message: GraytagChatMessage): boolean {
  return Boolean(message.informationMessage || message.isInfo || message.messageType === 'Information');
}

function isOwnedMessage(message: GraytagChatMessage): boolean {
  return Boolean(message.owned || message.isOwned);
}

export function findLatestBuyerInquiryMessage(messages: GraytagChatMessage[]): GraytagChatMessage | undefined {
  return messages.find((message) => Boolean(message.message) && !isInfoMessage(message) && !isOwnedMessage(message));
}
