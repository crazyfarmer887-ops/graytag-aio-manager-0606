import { parseChatTime } from './chat-alerts';

export type ChatSortMode = 'latest' | 'account';

export interface SortableChatRoom {
  dealUsid: string;
  chatRoomUuid: string;
  borrowerName?: string;
  productType?: string;
  keepAcct?: string | null;
  lenderChatUnread?: boolean;
  lastMessage?: string | null;
  lastMessageTime?: string | null;
}

function roomTime(room: SortableChatRoom): number {
  return parseChatTime(room.lastMessageTime) || 0;
}

function stableId(room: SortableChatRoom): string {
  return room.dealUsid || room.chatRoomUuid || '';
}

export function sortChatRoomsByLatestBuyerMessage<T extends SortableChatRoom>(rooms: T[] = []): T[] {
  return [...rooms].sort((a, b) => {
    const unreadDiff = Number(Boolean(b.lenderChatUnread)) - Number(Boolean(a.lenderChatUnread));
    if (unreadDiff) return unreadDiff;
    const timeDiff = roomTime(b) - roomTime(a);
    if (timeDiff) return timeDiff;
    return stableId(b).localeCompare(stableId(a));
  });
}

export function groupChatRoomsByAccount<T extends SortableChatRoom>(rooms: T[] = []): Record<string, Record<string, T[]>> {
  const groups: Record<string, Record<string, T[]>> = {};
  for (const room of sortChatRoomsByLatestBuyerMessage(rooms)) {
    const svc = room.productType?.trim() || '기타';
    const acct = room.keepAcct?.trim() || '(직접전달)';
    if (!groups[svc]) groups[svc] = {};
    if (!groups[svc][acct]) groups[svc][acct] = [];
    groups[svc][acct].push(room);
  }
  return groups;
}
