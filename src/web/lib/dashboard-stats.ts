export interface DashboardMember {
  dealUsid: string;
  name: string | null;
  status: string;
  statusName: string;
  price: string;
  purePrice: number;
  realizedSum: number;
  progressRatio: string;
  startDateTime: string | null;
  endDateTime: string | null;
  remainderDays: number;
  source: 'after' | 'before';
}

export interface DashboardAccount {
  email: string;
  serviceType: string;
  members: DashboardMember[];
  usingCount: number;
  activeCount: number;
  totalSlots: number;
  totalIncome: number;
  totalRealizedIncome: number;
  expiryDate: string | null;
  keepPasswd?: string;
}

export interface DashboardServiceGroup {
  serviceType: string;
  accounts: DashboardAccount[];
  totalUsingMembers: number;
  totalActiveMembers: number;
  totalIncome: number;
  totalRealized: number;
}

export interface DashboardData {
  services: DashboardServiceGroup[];
  onSaleByKeepAcct: Record<string, any[]>;
  summary: {
    totalUsingMembers: number;
    totalActiveMembers: number;
    totalIncome: number;
    totalRealized: number;
    totalAccounts: number;
  };
  updatedAt: string;
}

export interface DashboardManualMember {
  id: string;
  serviceType: string;
  accountEmail: string;
  memberName: string;
  startDate: string;
  endDate: string;
  price: number;
  source: string;
  memo: string;
  createdAt: string;
  status: 'active' | 'expired' | 'cancelled';
}

export interface ServiceStat {
  serviceType: string;
  accountCount: number;
  usingMembers: number;
  maxSlots: number;
  fillRatio: number;
  monthlyNet: number;
}

export interface ExpiredPartyItem {
  dealUsid: string;
  serviceType: string;
  accountEmail: string;
  memberName: string;
  status: string;
  statusName: string;
  endDate: string;
  price: string;
  source: 'graytag' | 'manual';
}

export interface PartyMaintenanceTarget {
  key: string;
  serviceType: string;
  accountEmail: string;
  reason: 'no-current-users' | 'expiring-soon';
  reasonLabel: string;
  usingCount: number;
  activeCount: number;
  totalSlots: number;
  expiryDate: string;
  daysUntilExpiry: number | null;
  lastMemberName: string;
  memberCount: number;
}

const PARTY_MAX: Record<string, number> = {
  '디즈니플러스': 6,
  '왓챠플레이': 4,
  '티빙': 4,
  '웨이브': 4,
  '넷플릭스': 5,
};

const EXCLUDED_SERVICES = new Set(['왓챠', '애플원', '유튜브', '왓챠플레이']);
const CANCELLED_STATUSES = new Set([
  'CancelByInspectionRejection',
  'CancelByDepositRejection',
  'CancelByNoShow',
  'CancelByLendingRejection',
]);
const ACTIVE_STATUSES = new Set([
  'Using',
  'UsingNearExpiration',
  'Delivered',
  'Delivering',
  'DeliveredAndCheckPrepaid',
  'LendingAcceptanceWaiting',
  'Reserved',
  'OnSale',
]);

export function getDashboardPartyMax(serviceType: string): number {
  return PARTY_MAX[serviceType] || 6;
}

function shouldCountAccount(account: DashboardAccount): boolean {
  return account.email !== '(직접전달)' && (account.usingCount > 0 || account.activeCount > 0);
}

export function buildServiceStats(data: DashboardData, _manuals: DashboardManualMember[] = []): ServiceStat[] {
  return data.services
    .filter((svc) => !EXCLUDED_SERVICES.has(svc.serviceType))
    .map((svc) => {
      const accounts = svc.accounts.filter(shouldCountAccount);
      const usingMembers = accounts.reduce((sum, acct) => sum + acct.usingCount, 0);
      const maxSlots = accounts.reduce((sum, acct) => sum + getDashboardPartyMax(acct.serviceType), 0);
      return {
        serviceType: svc.serviceType,
        accountCount: accounts.length,
        usingMembers,
        maxSlots,
        fillRatio: maxSlots > 0 ? usingMembers / maxSlots : 0,
        monthlyNet: 0,
      };
    })
    .filter((stat) => stat.accountCount > 0)
    .sort((a, b) => b.usingMembers - a.usingMembers || b.accountCount - a.accountCount);
}

function normalizeDate(value: string | null | undefined): string {
  if (!value) return '';
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const short = value.replace(/\s/g, '').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (short) {
    const yy = Number(short[1]);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return `${year}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}`;
  }
  const iso = value.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return value;
}

export function buildPartyMaintenanceTargets(
  data: DashboardData,
  options: { today?: string; expiringWithinDays?: number; limit?: number } = {},
): PartyMaintenanceTarget[] {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const withinDays = options.expiringWithinDays ?? 7;
  const limit = options.limit ?? 8;
  const items: PartyMaintenanceTarget[] = [];

  for (const svc of data.services) {
    if (EXCLUDED_SERVICES.has(svc.serviceType)) continue;
    for (const acct of svc.accounts) {
      if (acct.email === '(직접전달)') continue;
      const expiryDate = normalizeDate(acct.expiryDate);
      const expiryMs = expiryDate ? Date.parse(`${expiryDate}T00:00:00Z`) : NaN;
      const daysUntilExpiry = Number.isFinite(expiryMs) && Number.isFinite(todayMs)
        ? Math.ceil((expiryMs - todayMs) / 86400000)
        : null;
      const hasOpenedPartyBefore = (acct.members || []).some((member) => !CANCELLED_STATUSES.has(member.status) && member.status !== 'Deleted');
      const isNoCurrentUsers = hasOpenedPartyBefore && acct.usingCount === 0;
      const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= withinDays && acct.usingCount > 0;
      if (!isNoCurrentUsers && !isExpiringSoon) continue;

      const sortedMembers = [...(acct.members || [])].sort((a, b) => normalizeDate(b.endDateTime).localeCompare(normalizeDate(a.endDateTime)));
      const lastMember = sortedMembers.find((member) => !CANCELLED_STATUSES.has(member.status) && member.status !== 'Deleted');
      items.push({
        key: `${svc.serviceType}:${acct.email}`,
        serviceType: svc.serviceType,
        accountEmail: acct.email,
        reason: isNoCurrentUsers ? 'no-current-users' : 'expiring-soon',
        reasonLabel: isNoCurrentUsers ? '이용중 0명' : '7일 이내 만료',
        usingCount: acct.usingCount,
        activeCount: acct.activeCount,
        totalSlots: acct.totalSlots || getDashboardPartyMax(acct.serviceType),
        expiryDate,
        daysUntilExpiry,
        lastMemberName: lastMember?.name || '(미확인)',
        memberCount: acct.members.length,
      });
    }
  }

  return items
    .sort((a, b) => {
      if (a.reason !== b.reason) return a.reason === 'expiring-soon' ? -1 : 1;
      const aDays = a.daysUntilExpiry ?? 9999;
      const bDays = b.daysUntilExpiry ?? 9999;
      return aDays - bDays || a.serviceType.localeCompare(b.serviceType);
    })
    .slice(0, limit);
}

function isExpiredGraytagMember(member: DashboardMember): boolean {
  return !ACTIVE_STATUSES.has(member.status) && !CANCELLED_STATUSES.has(member.status) && member.status !== 'Deleted';
}

function isExpiredManualMember(member: DashboardManualMember, today: string): boolean {
  return member.status === 'expired' || (member.status !== 'cancelled' && member.endDate < today);
}

export function buildExpiredPartyItems(
  data: DashboardData,
  manuals: DashboardManualMember[] = [],
  options: { today?: string; limit?: number } = {},
): ExpiredPartyItem[] {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const limit = options.limit ?? 8;
  const items: ExpiredPartyItem[] = [];

  for (const svc of data.services) {
    for (const acct of svc.accounts) {
      if (acct.email === '(직접전달)') continue;
      for (const member of acct.members) {
        if (!isExpiredGraytagMember(member)) continue;
        items.push({
          dealUsid: member.dealUsid,
          serviceType: svc.serviceType,
          accountEmail: acct.email,
          memberName: member.name || '(미확인)',
          status: member.status,
          statusName: member.statusName || member.status,
          endDate: normalizeDate(member.endDateTime),
          price: member.price,
          source: 'graytag',
        });
      }
    }
  }

  for (const member of manuals) {
    if (!isExpiredManualMember(member, today)) continue;
    items.push({
      dealUsid: member.id,
      serviceType: member.serviceType,
      accountEmail: member.accountEmail,
      memberName: member.memberName,
      status: member.status,
      statusName: '수동 만료',
      endDate: member.endDate,
      price: `${member.price.toLocaleString()}원`,
      source: 'manual',
    });
  }

  return items
    .sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))
    .slice(0, limit);
}
