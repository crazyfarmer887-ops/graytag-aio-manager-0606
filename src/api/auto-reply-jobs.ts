import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export type AutoReplyJobStatus = 'queued' | 'drafted' | 'sent' | 'blocked' | 'error';
export type AutoReplyRisk = 'low' | 'medium' | 'high';

export interface AutoReplyJob {
  id: string;
  fingerprint: string;
  chatRoomUuid: string;
  dealUsid?: string;
  buyerName?: string;
  productType?: string;
  productName?: string;
  keepAcct?: string;
  buyerMessage: string;
  messageTime?: string;
  status: AutoReplyJobStatus;
  category?: string;
  risk?: AutoReplyRisk;
  draftReply?: string;
  blockReason?: string;
  hermesSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoReplyJobStore {
  jobs: Record<string, AutoReplyJob>;
  fingerprintToJobId: Record<string, string>;
}

export interface CreateAutoReplyJobInput {
  fingerprint: string;
  chatRoomUuid: string;
  dealUsid?: string;
  buyerName?: string;
  productType?: string;
  productName?: string;
  keepAcct?: string;
  buyerMessage: string;
  messageTime?: string;
  createdAt?: string;
}

export function createEmptyAutoReplyJobStore(): AutoReplyJobStore {
  return { jobs: {}, fingerprintToJobId: {} };
}

function jobIdFromFingerprint(fingerprint: string): string {
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i += 1) hash = ((hash << 5) - hash + fingerprint.charCodeAt(i)) | 0;
  return `ar_${Math.abs(hash).toString(36)}`;
}

export function createAutoReplyJob(store: AutoReplyJobStore, input: CreateAutoReplyJobInput): AutoReplyJob {
  const existingId = store.fingerprintToJobId[input.fingerprint];
  if (existingId && store.jobs[existingId]) return store.jobs[existingId];
  const now = input.createdAt || new Date().toISOString();
  let id = jobIdFromFingerprint(input.fingerprint);
  let suffix = 1;
  while (store.jobs[id]) id = `${jobIdFromFingerprint(input.fingerprint)}_${suffix++}`;
  const job: AutoReplyJob = {
    id,
    fingerprint: input.fingerprint,
    chatRoomUuid: input.chatRoomUuid,
    dealUsid: input.dealUsid,
    buyerName: input.buyerName,
    productType: input.productType,
    productName: input.productName,
    keepAcct: input.keepAcct,
    buyerMessage: input.buyerMessage,
    messageTime: input.messageTime,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  store.jobs[id] = job;
  store.fingerprintToJobId[input.fingerprint] = id;
  return job;
}

export function updateAutoReplyJob(store: AutoReplyJobStore, id: string, patch: Partial<Omit<AutoReplyJob, 'id' | 'createdAt'>>, updatedAt = new Date().toISOString()): AutoReplyJob {
  const current = store.jobs[id];
  if (!current) throw new Error(`Auto-reply job not found: ${id}`);
  const next = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt };
  store.jobs[id] = next;
  return next;
}

export function listAutoReplyJobs(store: AutoReplyJobStore, limit = 50): AutoReplyJob[] {
  return Object.values(store.jobs)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

function rebuildFingerprintIndex(store: AutoReplyJobStore): AutoReplyJobStore {
  const next: AutoReplyJobStore = { jobs: store.jobs || {}, fingerprintToJobId: {} };
  for (const job of Object.values(next.jobs)) {
    if (job?.fingerprint && job?.id) next.fingerprintToJobId[job.fingerprint] = job.id;
  }
  return next;
}

export function loadAutoReplyJobStore(path: string): AutoReplyJobStore {
  try {
    if (!existsSync(path)) return createEmptyAutoReplyJobStore();
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return rebuildFingerprintIndex({
      jobs: raw?.jobs && typeof raw.jobs === 'object' ? raw.jobs : {},
      fingerprintToJobId: raw?.fingerprintToJobId && typeof raw.fingerprintToJobId === 'object' ? raw.fingerprintToJobId : {},
    });
  } catch {
    return createEmptyAutoReplyJobStore();
  }
}

export function saveAutoReplyJobStore(path: string, store: AutoReplyJobStore): void {
  const dir = path.replace(/\/[^/]+$/, '');
  if (dir && dir !== path && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(rebuildFingerprintIndex(store), null, 2), 'utf8');
}
