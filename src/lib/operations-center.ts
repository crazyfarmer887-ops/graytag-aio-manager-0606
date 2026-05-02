export type ManualResponseSource = '카카오톡' | '수동고객' | '그레이태그' | '기타';
export type ManualResponseStatus = 'todo' | 'in_progress' | 'done' | 'snoozed';
export type ManualResponsePriority = 'low' | 'normal' | 'high';

export interface ManualResponseQueueItem {
  id: string;
  source: ManualResponseSource;
  buyerName: string;
  serviceType: string;
  accountEmail: string;
  message: string;
  status: ManualResponseStatus;
  priority: ManualResponsePriority;
  memo: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  snoozedUntil: string | null;
}

export interface ManualResponseQueueSummary {
  total: number;
  open: number;
  todo: number;
  inProgress: number;
  snoozed: number;
  done: number;
  kakaoOpen: number;
  highPriorityOpen: number;
}

export interface OperationsCenterInput {
  profileAuditRows?: Array<{ status?: string }>;
  autoReplyJobs?: Array<{ status?: string }>;
  manualQueueItems?: ManualResponseQueueItem[];
}

export interface OperationsCenterRecommendedAction {
  id: string;
  label: string;
  count: number;
  tone: 'danger' | 'warning' | 'info' | 'success';
}

export interface OperationsCenterSummary {
  actionRequired: number;
  profileIssues: number;
  replyQueueOpen: number;
  autoReplyNeedsReview: number;
  kakaoOpen: number;
}

export interface OperationsCenterModel {
  summary: OperationsCenterSummary;
  manualQueue: ManualResponseQueueSummary;
  recommendedActions: OperationsCenterRecommendedAction[];
}

function stableIdSeed(input: { source?: string; buyerName?: string; message?: string; now?: string }): string {
  const value = `${input.source || ''}:${input.buyerName || ''}:${input.message || ''}:${input.now || ''}`;
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

function normalizeSource(value: unknown): ManualResponseSource {
  const source = String(value || '').trim();
  if (source === '카카오톡' || source === '수동고객' || source === '그레이태그') return source;
  return '기타';
}

function normalizeStatus(value: unknown): ManualResponseStatus {
  if (value === 'in_progress' || value === 'done' || value === 'snoozed') return value;
  return 'todo';
}

function normalizePriority(value: unknown): ManualResponsePriority {
  if (value === 'low' || value === 'high') return value;
  return 'normal';
}

export function createManualResponseQueueItem(input: {
  id?: string;
  source?: ManualResponseSource | string;
  buyerName?: string;
  serviceType?: string;
  accountEmail?: string;
  message?: string;
  status?: ManualResponseStatus;
  priority?: ManualResponsePriority;
  memo?: string;
  now?: string;
  snoozedUntil?: string | null;
}): ManualResponseQueueItem {
  const now = input.now || new Date().toISOString();
  const source = normalizeSource(input.source);
  const buyerName = String(input.buyerName || '').trim();
  const message = String(input.message || '').trim();
  const status = normalizeStatus(input.status);
  return {
    id: input.id || `mrq_${stableIdSeed({ source, buyerName, message, now })}`,
    source,
    buyerName,
    serviceType: String(input.serviceType || '').trim(),
    accountEmail: String(input.accountEmail || '').trim(),
    message,
    status,
    priority: normalizePriority(input.priority),
    memo: String(input.memo || '').trim(),
    createdAt: now,
    updatedAt: now,
    doneAt: status === 'done' ? now : null,
    snoozedUntil: status === 'snoozed' ? (input.snoozedUntil || null) : null,
  };
}

export function mergeManualResponseQueueItem(current: ManualResponseQueueItem, patch: Partial<ManualResponseQueueItem>, now = new Date().toISOString()): ManualResponseQueueItem {
  const status = patch.status !== undefined ? normalizeStatus(patch.status) : current.status;
  return {
    ...current,
    source: patch.source !== undefined ? normalizeSource(patch.source) : current.source,
    buyerName: patch.buyerName !== undefined ? String(patch.buyerName || '').trim() : current.buyerName,
    serviceType: patch.serviceType !== undefined ? String(patch.serviceType || '').trim() : current.serviceType,
    accountEmail: patch.accountEmail !== undefined ? String(patch.accountEmail || '').trim() : current.accountEmail,
    message: patch.message !== undefined ? String(patch.message || '').trim() : current.message,
    priority: patch.priority !== undefined ? normalizePriority(patch.priority) : current.priority,
    memo: patch.memo !== undefined ? String(patch.memo || '').trim() : current.memo,
    status,
    updatedAt: now,
    doneAt: status === 'done' ? (current.doneAt || now) : null,
    snoozedUntil: status === 'snoozed' ? (patch.snoozedUntil ?? current.snoozedUntil ?? null) : null,
  };
}

export function summarizeManualResponseQueue(items: ManualResponseQueueItem[] = []): ManualResponseQueueSummary {
  const summary: ManualResponseQueueSummary = { total: items.length, open: 0, todo: 0, inProgress: 0, snoozed: 0, done: 0, kakaoOpen: 0, highPriorityOpen: 0 };
  for (const item of items) {
    if (item.status === 'done') summary.done += 1;
    if (item.status === 'todo') summary.todo += 1;
    if (item.status === 'in_progress') summary.inProgress += 1;
    if (item.status === 'snoozed') summary.snoozed += 1;
    if (item.status !== 'done') {
      summary.open += 1;
      if (item.source === '카카오톡') summary.kakaoOpen += 1;
      if (item.priority === 'high') summary.highPriorityOpen += 1;
    }
  }
  return summary;
}

export function buildOperationsCenter(input: OperationsCenterInput): OperationsCenterModel {
  const manualQueue = summarizeManualResponseQueue(input.manualQueueItems || []);
  const profileIssues = (input.profileAuditRows || []).filter((row) => ['mismatch', 'unchecked', 'error'].includes(String(row.status || ''))).length;
  const autoReplyNeedsReview = (input.autoReplyJobs || []).filter((job) => ['drafted', 'blocked', 'error'].includes(String(job.status || ''))).length;
  const summary: OperationsCenterSummary = {
    actionRequired: profileIssues + manualQueue.open + autoReplyNeedsReview,
    profileIssues,
    replyQueueOpen: manualQueue.open,
    autoReplyNeedsReview,
    kakaoOpen: manualQueue.kakaoOpen,
  };
  const recommendedActions: OperationsCenterRecommendedAction[] = [];
  if (profileIssues > 0) recommendedActions.push({ id: 'profile-audit', label: '프로필 수 확인 필요', count: profileIssues, tone: 'danger' });
  if (manualQueue.open > 0) recommendedActions.push({ id: 'manual-response', label: '수동/카카오톡 응대 필요', count: manualQueue.open, tone: manualQueue.highPriorityOpen > 0 ? 'danger' : 'warning' });
  if (autoReplyNeedsReview > 0) recommendedActions.push({ id: 'auto-reply', label: 'AI 답변 초안 확인', count: autoReplyNeedsReview, tone: 'info' });
  if (recommendedActions.length === 0) recommendedActions.push({ id: 'clear', label: '운영센터 확인 완료', count: 0, tone: 'success' });
  return { summary, manualQueue, recommendedActions };
}
