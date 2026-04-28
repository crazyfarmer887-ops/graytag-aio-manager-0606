export type AutoReplyUiStatus = 'queued' | 'drafted' | 'sent' | 'blocked' | 'error';

export interface AutoReplyLogJob {
  id: string;
  status: AutoReplyUiStatus;
  buyerName?: string;
  productType?: string;
  productName?: string;
  buyerMessage?: string;
  draftReply?: string;
  blockReason?: string;
  category?: string;
  risk?: 'low' | 'medium' | 'high';
  createdAt?: string;
  updatedAt?: string;
}

export interface AutoReplySummary {
  total: number;
  queued: number;
  drafted: number;
  sent: number;
  blocked: number;
  error: number;
}

export function summarizeAutoReplyJobs(jobs: AutoReplyLogJob[] = []): AutoReplySummary {
  const summary: AutoReplySummary = { total: jobs.length, queued: 0, drafted: 0, sent: 0, blocked: 0, error: 0 };
  for (const job of jobs) {
    if (job.status in summary) summary[job.status as keyof Omit<AutoReplySummary, 'total'>] += 1;
  }
  return summary;
}

export function autoReplyStatusLabel(status: AutoReplyUiStatus): string {
  switch (status) {
    case 'queued': return '대기';
    case 'drafted': return '초안 대기';
    case 'sent': return '발송 완료';
    case 'blocked': return '사람 확인';
    case 'error': return '오류';
  }
}

export function autoReplyStatusTone(status: AutoReplyUiStatus): { background: string; color: string } {
  switch (status) {
    case 'sent': return { background: '#ECFDF5', color: '#047857' };
    case 'blocked': return { background: '#FFF7ED', color: '#C2410C' };
    case 'error': return { background: '#FEF2F2', color: '#B91C1C' };
    case 'queued': return { background: '#EFF6FF', color: '#1D4ED8' };
    case 'drafted': return { background: '#F5F3FF', color: '#7C3AED' };
  }
}
