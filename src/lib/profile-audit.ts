export type ProfileAuditStatus = 'match' | 'mismatch' | 'unchecked' | 'unsupported' | 'error';

export interface ProfileAuditAccount {
  email: string;
  serviceType: string;
  usingCount: number;
  activeCount: number;
  members?: unknown[];
}

export interface ProfileAuditService {
  serviceType: string;
  accounts: ProfileAuditAccount[];
}

export interface ProfileAuditData {
  services: ProfileAuditService[];
}

export interface ProfileAuditManualMember {
  accountEmail: string;
  serviceType: string;
  status: 'active' | 'expired' | 'cancelled';
  startDate?: string;
  endDate?: string;
}

export interface ProfileAuditStoredResult {
  actualProfileCount: number | null;
  checkedAt: string;
  checker: string;
  status?: ProfileAuditStatus;
  message?: string;
  profileNames?: string[];
}

export interface ProfileAuditRow {
  id: string;
  serviceType: string;
  accountEmail: string;
  expectedPartyCount: number;
  graytagUsingCount: number;
  activeManualCount: number;
  actualProfileCount: number | null;
  status: ProfileAuditStatus;
  checkedAt: string | null;
  checker: string;
  message: string;
}

export interface ProfileAuditSummary {
  total: number;
  match: number;
  mismatch: number;
  unchecked: number;
  unsupported: number;
  error: number;
}

export type ProfileAuditStore = Record<string, ProfileAuditStoredResult>;

const SUPPORTED_SERVICES = new Set(['넷플릭스', '디즈니플러스', '티빙', '웨이브']);

export function profileAuditKey(serviceType: string, accountEmail: string): string {
  return `${serviceType}::${accountEmail}`;
}


export function compareProfileCounts(actualProfileCount: number | null | undefined, expectedPartyCount: number): ProfileAuditStatus {
  if (actualProfileCount === null || actualProfileCount === undefined || Number.isNaN(actualProfileCount)) return 'unchecked';
  return actualProfileCount === expectedPartyCount ? 'match' : 'mismatch';
}

function activeManualCount(manuals: ProfileAuditManualMember[], serviceType: string, accountEmail: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return manuals.filter((member) => (
    member.serviceType === serviceType
    && member.accountEmail === accountEmail
    && member.status !== 'cancelled'
    && (!member.startDate || member.startDate <= today)
    && (!member.endDate || member.endDate >= today)
  )).length;
}

export function buildProfileAuditRows(data: ProfileAuditData, manuals: ProfileAuditManualMember[] = [], store: ProfileAuditStore = {}): ProfileAuditRow[] {
  const rows: ProfileAuditRow[] = [];

  for (const service of data.services || []) {
    for (const account of service.accounts || []) {
      if (!account.email || account.email === '(직접전달)') continue;
      if (account.usingCount <= 0 && account.activeCount <= 0) continue;

      const manualCount = activeManualCount(manuals, account.serviceType, account.email);
      const expectedPartyCount = account.usingCount + manualCount;
      const key = profileAuditKey(account.serviceType, account.email);
      const stored = store[key];
      const baseStatus = compareProfileCounts(stored?.actualProfileCount, expectedPartyCount);
      const unsupported = !SUPPORTED_SERVICES.has(account.serviceType);
      const status = stored?.status === 'error'
        ? 'error'
        : unsupported && !stored
          ? 'unsupported'
          : baseStatus;

      rows.push({
        id: key,
        serviceType: account.serviceType,
        accountEmail: account.email,
        expectedPartyCount,
        graytagUsingCount: account.usingCount,
        activeManualCount: manualCount,
        actualProfileCount: stored?.actualProfileCount ?? null,
        status,
        checkedAt: stored?.checkedAt ?? null,
        checker: stored?.checker ?? (unsupported ? 'unsupported' : 'not-run'),
        message: stored?.message || (unsupported ? '이 서비스는 아직 자동 프로필 조회 어댑터가 없어요.' : '아직 실제 프로필 조회를 실행하지 않았어요.'),
      });
    }
  }

  return rows.sort((a, b) => a.serviceType.localeCompare(b.serviceType) || a.accountEmail.localeCompare(b.accountEmail));
}

export function summarizeProfileAudit(rows: ProfileAuditRow[]): ProfileAuditSummary {
  return rows.reduce<ProfileAuditSummary>((summary, row) => {
    summary.total += 1;
    summary[row.status] += 1;
    return summary;
  }, { total: 0, match: 0, mismatch: 0, unchecked: 0, unsupported: 0, error: 0 });
}

export async function runProfileCheckPlaceholder(row: ProfileAuditRow): Promise<ProfileAuditStoredResult> {
  return {
    actualProfileCount: null,
    checkedAt: new Date().toISOString(),
    checker: 'adapter-required',
    status: 'unchecked',
    message: `${row.serviceType} 실제 로그인/프로필 조회 어댑터 연결이 필요해요. 계정/이메일 접근 정보는 확인 대상으로 준비됐습니다.`,
  };
}
