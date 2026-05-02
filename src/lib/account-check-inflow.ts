export interface AccountCheckDealLike {
  dealUsid?: string | null;
  dealStatus?: string | null;
  lenderDealStatusName?: string | null;
  borrowerDealStatusName?: string | null;
  statusName?: string | null;
  productTypeString?: string | null;
  borrowerName?: string | null;
  startDateTime?: string | null;
  deliveredDateTime?: string | null;
  createdDateTime?: string | null;
  registeredDateTime?: string | null;
  dealRegisteredDateTime?: string | null;
  productRegisteredDateTime?: string | null;
  updatedAt?: string | null;
}

export interface AccountCheckInflowRecord {
  dealUsid: string;
  firstSeenDate: string;
  firstSeenAt: string;
  serviceType: string;
  status: string;
  statusName: string;
  updatedAt: string;
}

export type AccountCheckInflowStore = Record<string, AccountCheckInflowRecord>;

const CANCELLED_OR_REMOVED_STATUSES = new Set([
  'Deleted',
  'CancelByInspectionRejection',
  'CancelByDepositRejection',
  'CancelByNoShow',
  'CancelByLendingRejection',
  'FinishedByBorrowerRequest',
  'FinishedByLenderRequest',
]);

export function isAccountCheckStatus(deal: AccountCheckDealLike): boolean {
  const status = String(deal.dealStatus || '');
  const statusName = String(deal.lenderDealStatusName || deal.borrowerDealStatusName || deal.statusName || '');
  return status === 'DeliveredAndCheckPrepaid' || statusName.includes('계정확인중') || statusName.includes('계정 확인중');
}

export function isCancelledOrRemovedDeal(deal: AccountCheckDealLike): boolean {
  return CANCELLED_OR_REMOVED_STATUSES.has(String(deal.dealStatus || ''));
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
  return '';
}

function dealCandidateDate(deal: AccountCheckDealLike, now: string): string {
  return normalizeDate(
    deal.deliveredDateTime
      || deal.createdDateTime
      || deal.registeredDateTime
      || deal.dealRegisteredDateTime
      || deal.productRegisteredDateTime
      || deal.updatedAt
      || now,
  ) || now.slice(0, 10);
}

export function buildAccountCheckInflowStore(
  deals: AccountCheckDealLike[],
  previous: AccountCheckInflowStore = {},
  options: { now?: string } = {},
): { store: AccountCheckInflowStore; inflowDateByDealUsid: Record<string, string> } {
  const now = options.now || new Date().toISOString();
  const store: AccountCheckInflowStore = { ...previous };
  const liveDealIds = new Set<string>();

  for (const deal of deals || []) {
    const dealUsid = String(deal.dealUsid || '').trim();
    if (!dealUsid) continue;
    liveDealIds.add(dealUsid);

    if (isCancelledOrRemovedDeal(deal)) {
      delete store[dealUsid];
      continue;
    }

    const status = String(deal.dealStatus || '');
    const statusName = String(deal.lenderDealStatusName || deal.borrowerDealStatusName || deal.statusName || status);
    const wasTracked = Boolean(store[dealUsid]);

    if (isAccountCheckStatus(deal) && !wasTracked) {
      store[dealUsid] = {
        dealUsid,
        firstSeenDate: dealCandidateDate(deal, now),
        firstSeenAt: now,
        serviceType: String(deal.productTypeString || '').trim() || '기타',
        status,
        statusName,
        updatedAt: now,
      };
      continue;
    }

    if (wasTracked) {
      store[dealUsid] = {
        ...store[dealUsid],
        serviceType: String(deal.productTypeString || store[dealUsid].serviceType || '').trim() || '기타',
        status,
        statusName,
        updatedAt: now,
      };
    }
  }

  for (const dealUsid of Object.keys(store)) {
    if (!liveDealIds.has(dealUsid)) delete store[dealUsid];
  }

  const inflowDateByDealUsid = Object.fromEntries(
    Object.entries(store).map(([dealUsid, record]) => [dealUsid, record.firstSeenDate]),
  );
  return { store, inflowDateByDealUsid };
}
