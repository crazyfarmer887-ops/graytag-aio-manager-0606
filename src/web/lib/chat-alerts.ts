export interface ChatAlertRoom {
  dealUsid?: string;
  chatRoomUuid: string;
  borrowerName?: string;
  productType?: string;
  productName?: string;
  keepAcct?: string | null;
  statusName?: string;
  dealStatus?: string;
  lenderChatUnread?: boolean;
  lastMessage?: string | null;
  lastMessageTime?: string | null;
  lastMessageMissingReason?: string;
}

export interface ChatAlertItem {
  id: string;
  dealUsid?: string;
  chatRoomUuid: string;
  buyerName: string;
  serviceType: string;
  productName: string;
  accountLabel: string;
  message: string;
  unread: boolean;
  missingMessage: boolean;
  lastMessageTime?: string | null;
  sortTime: number;
  timeLabel: string;
  title: string;
}

const MISSING_MESSAGE = '메시지 내용을 불러오지 못했어요 · 채팅방 확인 필요';

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

export function parseChatTime(value?: string | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const dotted = trimmed.match(/^(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (dotted) {
    const rawYear = Number(dotted[1]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const month = Number(dotted[2]) - 1;
    const day = Number(dotted[3]);
    const hour = Number(dotted[4] || 0);
    const minute = Number(dotted[5] || 0);
    const parsed = new Date(year, month, day, hour, minute).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = new Date(trimmed).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatChatTime(value?: string | null): string {
  if (!value) return '시간 확인 필요';
  const trimmed = value.trim();
  const dotted = trimmed.match(/^(\d{2,4})\.\s*(\d{1,2})\.\s*(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (dotted) {
    return `${Number(dotted[2])}/${Number(dotted[3])}${dotted[4] ? ` ${String(dotted[4]).padStart(2, '0')}:${String(dotted[5] || '0').padStart(2, '0')}` : ''}`;
  }
  const parsed = parseChatTime(trimmed);
  if (!parsed) return trimmed;
  const d = new Date(parsed);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function accountLabel(room: ChatAlertRoom): string {
  const raw = room.keepAcct?.trim();
  return raw || '(직접전달)';
}

function fallbackSortValue(_room: ChatAlertRoom, index: number): number {
  return -index;
}

export function buildChatAlerts(rooms: ChatAlertRoom[] = [], limit = 5): ChatAlertItem[] {
  return rooms
    .map((room, index): ChatAlertItem | null => {
      const cleanMessage = stripChatMessage(room.lastMessage || '');
      const missingMessage = Boolean(room.lenderChatUnread) && !cleanMessage;
      if (!cleanMessage && !missingMessage) return null;
      const buyerName = room.borrowerName?.trim() || '구매자';
      const serviceType = room.productType?.trim() || '기타';
      const productName = room.productName?.trim() || serviceType;
      const account = accountLabel(room);
      const sortTime = parseChatTime(room.lastMessageTime) || fallbackSortValue(room, index);
      return {
        id: room.chatRoomUuid || room.dealUsid || `${buyerName}-${cleanMessage || account}`,
        dealUsid: room.dealUsid,
        chatRoomUuid: room.chatRoomUuid,
        buyerName,
        serviceType,
        productName,
        accountLabel: account,
        message: (cleanMessage || MISSING_MESSAGE).slice(0, 140),
        unread: Boolean(room.lenderChatUnread),
        missingMessage,
        lastMessageTime: room.lastMessageTime,
        sortTime,
        timeLabel: formatChatTime(room.lastMessageTime),
        title: `${buyerName} · ${serviceType} · ${account}`,
      };
    })
    .filter((item): item is ChatAlertItem => Boolean(item))
    .sort((a, b) => Number(b.unread) - Number(a.unread) || b.sortTime - a.sortTime)
    .slice(0, limit);
}

export function buildUnreadChatAlerts(rooms: ChatAlertRoom[] = [], limit = 5): ChatAlertItem[] {
  return buildChatAlerts(rooms.filter((room) => Boolean(room.lenderChatUnread)), limit);
}
