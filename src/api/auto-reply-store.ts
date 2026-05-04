export type AutoReplyProcessedStatus = 'queued' | 'drafted' | 'sent' | 'blocked' | 'error' | 'ignored';

export interface AutoReplyState {
  processedFingerprints: Record<string, {
    firstSeenAt: string;
    status: AutoReplyProcessedStatus;
    chatRoomUuid: string;
    dealUsid?: string;
  }>;
  roomReplyHistory: Record<string, string[]>;
}

export function createEmptyAutoReplyState(): AutoReplyState {
  return { processedFingerprints: {}, roomReplyHistory: {} };
}

export function shouldProcessFingerprint(state: AutoReplyState, fingerprint: string): boolean {
  return !state.processedFingerprints[fingerprint];
}

export function markProcessed(
  state: AutoReplyState,
  fingerprint: string,
  options: { chatRoomUuid: string; status: AutoReplyProcessedStatus; now?: string; dealUsid?: string },
): AutoReplyState {
  state.processedFingerprints[fingerprint] = {
    firstSeenAt: options.now || new Date().toISOString(),
    status: options.status,
    chatRoomUuid: options.chatRoomUuid,
    dealUsid: options.dealUsid,
  };
  return state;
}

export function pruneAutoReplyState(state: AutoReplyState, now = new Date(), maxAgeDays = 14): AutoReplyState {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const [fingerprint, entry] of Object.entries(state.processedFingerprints)) {
    const time = new Date(entry.firstSeenAt).getTime();
    if (Number.isFinite(time) && time < cutoff) delete state.processedFingerprints[fingerprint];
  }
  return state;
}

export function recordRoomReply(state: AutoReplyState, chatRoomUuid: string, at = new Date().toISOString()): AutoReplyState {
  state.roomReplyHistory[chatRoomUuid] = [...(state.roomReplyHistory[chatRoomUuid] || []), at];
  return state;
}
