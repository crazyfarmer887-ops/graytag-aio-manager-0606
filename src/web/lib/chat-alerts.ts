export interface ChatAlertRoom {
  dealUsid?: string;
  chatRoomUuid: string;
  borrowerName?: string;
  productType?: string;
  productName?: string;
  lenderChatUnread?: boolean;
  lastMessage?: string;
  lastMessageTime?: string;
}

export interface ChatAlertItem {
  id: string;
  dealUsid?: string;
  chatRoomUuid: string;
  buyerName: string;
  serviceType: string;
  productName: string;
  message: string;
  unread: boolean;
  lastMessageTime?: string;
  title: string;
}

export function stripChatMessage(input = ''): string {
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

function timeValue(value?: string): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildChatAlerts(rooms: ChatAlertRoom[] = [], limit = 5): ChatAlertItem[] {
  return rooms
    .map((room) => {
      const message = stripChatMessage(room.lastMessage || '');
      if (!message) return null;
      const buyerName = room.borrowerName?.trim() || '구매자';
      const serviceType = room.productType?.trim() || '기타';
      const productName = room.productName?.trim() || serviceType;
      return {
        id: room.chatRoomUuid || room.dealUsid || `${buyerName}-${message}`,
        dealUsid: room.dealUsid,
        chatRoomUuid: room.chatRoomUuid,
        buyerName,
        serviceType,
        productName,
        message: message.slice(0, 120),
        unread: Boolean(room.lenderChatUnread),
        lastMessageTime: room.lastMessageTime,
        title: `${buyerName} · ${serviceType}`,
      } satisfies ChatAlertItem;
    })
    .filter((item): item is ChatAlertItem => Boolean(item))
    .sort((a, b) => Number(b.unread) - Number(a.unread) || timeValue(b.lastMessageTime) - timeValue(a.lastMessageTime))
    .slice(0, limit);
}
