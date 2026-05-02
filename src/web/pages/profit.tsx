import { getExtraShareOn, toggleExtraShare as _toggle, loadExtraShareFromStorage, saveExtraShareToStorage, type ExtraShareMap } from "../../../extra-share";
import { useState, useEffect } from "react";
import { CATEGORIES } from "../lib/constants";
import {
  RefreshCw, KeyRound, Loader2, AlertCircle, ExternalLink,
  TrendingUp, TrendingDown, ChevronLeft, ChevronRight, ChevronDown,
  Calendar, Wallet, ArrowUpRight, ArrowDownRight, Minus, Info, Mail, User,
  Settings, Check, X, CreditCard, Pencil,
} from "lucide-react";

// ─── SimpleLogin Alias 타입 ──────────────────────────────────────
interface SLAlias {
  id: number;
  email: string;
  enabled: boolean;
  creation_timestamp: number; // unix timestamp (초)
}

// ─── 수동 파티원 타입 ─────────────────────────────────────────────
interface ManualMember {
  id: string; serviceType: string; accountEmail: string;
  memberName: string; startDate: string; endDate: string;
  price: number; source: string; memo: string; createdAt: string;
  status: 'active' | 'expired' | 'cancelled';
}

/** 이메일 주소 → 사람이 읽기 좋은 표시명
 * disney1.pronto693@aleeas.com → 디즈니1
 * netflix3.outsmart173@aleeas.com → 넷플3
 * wavve2.uncounted030@aleeas.com → 웨이브2
 * gtwavve1 → 티빙1
 * exfoliate_cartel596@simplelogin.com → 그대로 (심플로그인 랜덤)
 */
const SVC_PREFIX_MAP: Record<string, string> = {
  disney: '디즈니', netflix: '넷플', wavve: '웨이브', tving: '티빙',
};
function emailAlias(email: string): string {
  // aleeas.com 패턴: {svc}{n}.{random}@aleeas.com
  const aleeasMatch = email.match(/^([a-z]+?)(\d+)\.[^@]+@aleeas\.com$/);
  if (aleeasMatch) {
    const [, svc, num] = aleeasMatch;
    const label = SVC_PREFIX_MAP[svc] || svc;
    return `${label}${num}`;
  }
  // gtwavve{n} 패턴
  const gtwavveMatch = email.match(/^gtwavve(\d*)$/);
  if (gtwavveMatch) {
    const num = gtwavveMatch[1] || '1';
    return `티빙${num}`;
  }
  // simplelogin.com - 그대로 짧게
  if (email.includes('@simplelogin.com')) {
    return email.split('@')[0].replace(/_/g, ' ').slice(0, 12) + '…';
  }
  if (email.includes('@anonaddy.me')) {
    return email.split('@')[0].slice(0, 10) + '…';
  }
  // (직접전달) 등
  if (email === '(직접전달)') return '직접전달';
  return email.length > 18 ? email.slice(0, 16) + '…' : email;
}

/** 오늘 기준 active manual members 수 */
function getActiveManualCount(manuals: ManualMember[], serviceType: string, accountEmail: string): number {
  const today = new Date().toISOString().split('T')[0];
  return manuals.filter(m =>
    m.serviceType === serviceType &&
    m.accountEmail === accountEmail &&
    m.status !== 'cancelled' &&
    m.startDate <= today &&
    m.endDate >= today
  ).length;
}

// ─── 개인 구독 설정 타입 ─────────────────────────────────────────
interface PersonalSubSettings {
  netflix: boolean;   // 넷플릭스 추가 공유 (+10,000/월)
  tving: boolean;     // 티빙 추가 공유 (+15,000/월)
  disney: boolean;    // 디즈니+ 추가 공유 (+추가금액/월)
  netflixDay: number; // 결제일
  tvingDay: number;
  disneyDay: number;
}

const PERSONAL_SUB_KEY = 'graytag_personal_sub_v1';
const SUB_START_KEY = 'graytag_sub_start_v1'; // { [email]: number(day) }

const DEFAULT_PERSONAL_SUB: PersonalSubSettings = {
  netflix: false, tving: false, disney: false,
  netflixDay: 1, tvingDay: 1, disneyDay: 1,
};

const PERSONAL_SUB_COSTS: Record<string, number> = {
  netflix: 10000,  // 넷플릭스 추가 공유 비용
  tving: 15000,    // 티빙 추가 공유 비용
  disney: 9900,    // 디즈니+ 추가 공유 비용 (4K 기준)
};

const loadPersonalSub = (): PersonalSubSettings => {
  try { return { ...DEFAULT_PERSONAL_SUB, ...JSON.parse(localStorage.getItem(PERSONAL_SUB_KEY) || '{}') }; }
  catch { return DEFAULT_PERSONAL_SUB; }
};
const savePersonalSub = (s: PersonalSubSettings) => localStorage.setItem(PERSONAL_SUB_KEY, JSON.stringify(s));


const loadSubStarts = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(SUB_START_KEY) || '{}'); }
  catch { return {}; }
};
const saveSubStarts = (m: Record<string, number>) => localStorage.setItem(SUB_START_KEY, JSON.stringify(m));

// ─── 타입 ──────────────────────────────────────────────────────
interface Member {
  dealUsid: string; name: string | null; status: string; statusName: string;
  price: string; purePrice: number; realizedSum: number; progressRatio: string;
  startDateTime: string | null; endDateTime: string | null; remainderDays: number;
  source: 'after' | 'before';
}
interface Account {
  email: string; serviceType: string; members: Member[];
  usingCount: number; activeCount: number; totalSlots: number;
  totalIncome: number; totalRealizedIncome: number; expiryDate: string | null;
}
interface ServiceGroup {
  serviceType: string; accounts: Account[];
  totalUsingMembers: number; totalActiveMembers: number;
  totalIncome: number; totalRealized: number;
}
interface ManageData {
  services: ServiceGroup[];
  summary: {
    totalUsingMembers: number; totalActiveMembers: number;
    totalIncome: number; totalRealized: number; totalAccounts: number;
  };
  updatedAt: string;
}

// ─── 계산 모드 타입 ─────────────────────────────────────────────
type CalcMode = 'snapshot' | 'thismonth' | 'monthly30';

// ─── 비즈니스 로직 상수 ─────────────────────────────────────────
const COMMISSION_RATE = 0.10;
const SUBSCRIPTION_COST: Record<string, number> = {
  '넷플릭스': 17000,
  '디즈니플러스': 14000,
  '티빙': 10000,
  '웨이브': 10000,
};
// 파티 추가공유 비용/수입 (에브리뷰 등 — 토글 ON인 파티만 적용)
const EXTRA_COST: Record<string, number> = {
  '넷플릭스': 10000,
  '디즈니플러스': 5000,
  '티빙': 15000,
};
const EXTRA_INCOME: Record<string, number> = {
  '넷플릭스': 18000,
  '디즈니플러스': 9000,
  '티빙': 24000,
};

// 구독료 조회 (단순 조회)
const getSubscriptionCost = (svcType: string): number => {
  return SUBSCRIPTION_COST[svcType] || 0;
};

// ─── 파티원 상태 뱃지 ────────────────────────────────────────────
const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  Using:                       { label:'이용 중',   color:'#7C3AED', bg:'#F5F3FF' },
  UsingNearExpiration:         { label:'만료 임박',  color:'#D97706', bg:'#FFFBEB' },
  OnSale:                      { label:'판매 중',   color:'#059669', bg:'#ECFDF5' },
  Delivered:                   { label:'전달 완료',  color:'#2563EB', bg:'#EFF6FF' },
  Delivering:                  { label:'전달 중',   color:'#0891B2', bg:'#ECFEFF' },
  Reserved:                    { label:'예약됨',    color:'#6366F1', bg:'#EEF2FF' },
  LendingAcceptanceWaiting:    { label:'수락 대기',  color:'#D97706', bg:'#FFFBEB' },
  NormalFinished:              { label:'완료',      color:'#6B7280', bg:'#F3F4F6' },
  FinishedByBorrowerRequest:   { label:'중도 종료',  color:'#9CA3AF', bg:'#F9FAFB' },
  FinishedByLenderRequest:     { label:'중도 종료',  color:'#9CA3AF', bg:'#F9FAFB' },
  CancelByNoShow:              { label:'취소(노쇼)', color:'#EF4444', bg:'#FFF0F0' },
  CancelByDepositRejection:    { label:'취소(입금)', color:'#EF4444', bg:'#FFF0F0' },
  CancelByInspectionRejection: { label:'취소(검수)', color:'#EF4444', bg:'#FFF0F0' },
};
const bge = (s: string, n: string) => STATUS_BADGE[s] || { label:n||s, color:'#6B7280', bg:'#F3F4F6' };
const USING_SET = new Set(['Using', 'UsingNearExpiration']);
const ACTIVE_SET = new Set(['Using','UsingNearExpiration','Delivered','Delivering','DeliveredAndCheckPrepaid','LendingAcceptanceWaiting','Reserved','OnSale']);
const fmtDate = (s: string|null) => s ? s.replace(/\s/g,'').replace(/\.(?=\S)/g,'/').replace(/\.$/, '') : '-';

// ─── 헬퍼 ──────────────────────────────────────────────────────
const AUTO_COOKIE_ID = '__session_keeper__';
const AUTO_COOKIE: CookieSet = { id: AUTO_COOKIE_ID, label: '자동 (Session Keeper)', AWSALB: '', AWSALBCORS: '', JSESSIONID: '__auto__' };
const STORAGE_KEY = 'graytag_cookies_v2';
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => { try { return [AUTO_COOKIE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')]; } catch { return [AUTO_COOKIE]; } };

const fmtMoney = (n: number) => {
  if (n === 0) return '0원';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  return `${sign}${abs.toLocaleString()}원`;
};
const fmtMoneyPlain = (n: number) => `${Math.abs(n).toLocaleString()}원`;

const svcLogo = (s: string) => CATEGORIES.find(c => c.label === s || s.includes(c.label.slice(0, 3)))?.logo;
const svcColor = (s: string) => {
  const c = CATEGORIES.find(c => c.label === s || s.includes(c.label.slice(0, 3)));
  return { color: c?.color || '#6B7280', bg: c?.bg || '#F3F4F6' };
};

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  // "26. 03. 14" or "2026. 03. 14" -> "2026-03-14"
  const cleaned = s.replace(/\s/g, '').replace(/\./g, '-').replace(/-$/, '');
  // 2자리 연도 보정
  const parts = cleaned.split('-');
  if (parts.length >= 3) {
    let y = parseInt(parts[0]);
    if (y < 100) y += 2000;
    const d = new Date(y, parseInt(parts[1]) - 1, parseInt(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}


// ─── 구독 결제 횟수 계산 ──────────────────────────────────────────
// earliestStart ~ latestEnd 사이에 payDay(일)로 결제가 몇 번 발생하는지
// payDate >= earliestStart AND payDate < latestEnd 인 경우만 카운트
function countPayments(earliestStart: Date, latestEnd: Date, payDay: number): number {
  let count = 0;
  let y = earliestStart.getFullYear();
  let mo = earliestStart.getMonth();
  const endY = latestEnd.getFullYear();
  const endMo = latestEnd.getMonth();
  while (y < endY || (y === endY && mo <= endMo)) {
    const daysInMo = new Date(y, mo + 1, 0).getDate();
    const actualDay = Math.min(payDay, daysInMo);
    const payDate = new Date(y, mo, actualDay);
    if (payDate >= earliestStart && payDate < latestEnd) count++;
    mo++;
    if (mo > 11) { mo = 0; y++; }
  }
  return count;
}

function estimateRenewalDay(acct: Account): number | null {
  for (const m of acct.members) {
    if (['Using', 'UsingNearExpiration'].includes(m.status) && m.endDateTime) {
      const d = parseDate(m.endDateTime);
      if (d) return d.getDate();
    }
  }
  if (acct.expiryDate) {
    const d = parseDate(acct.expiryDate);
    if (d) return d.getDate();
  }
  return null;
}

const ACTUAL_PARTY_SET = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
const isAccountCheckingMember = (m: Pick<Member, 'status' | 'statusName'>) => (
  m.status === 'DeliveredAndCheckPrepaid' ||
  String(m.statusName || '').includes('계정확인중') ||
  String(m.statusName || '').includes('계정 확인중')
);
const isActualPartyMember = (m: Pick<Member, 'status' | 'statusName'>) => ACTUAL_PARTY_SET.has(m.status) || isAccountCheckingMember(m);

// ─── 파티원 일당 계산 ─────────────────────────────────────────
function calcDailyRate(m: Member): number {
  if (m.purePrice <= 0 || !isActualPartyMember(m)) return 0;

  const start = parseDate(m.startDateTime);
  const end = parseDate(m.endDateTime);
  const totalDays = start && end
    ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000))
    : 30;
  return m.purePrice / totalDays;
}

// 파티원 수입 (모드별) — 월 단위 정산 기준
// 정산은 시작일 기준 매월 N일에 발생 (예: 3/10 시작 → 3/10, 4/10, 5/10...)
function calcMemberIncome(m: Member, mode: CalcMode, now: Date): number {
  const daily = calcDailyRate(m);
  if (daily <= 0) return 0;

  if (mode === 'monthly30') {
    // 30일 환산: 일당 × 30
    return Math.round(daily * 30);
  }

  const start = parseDate(m.startDateTime);
  const end = parseDate(m.endDateTime);

  if (mode === 'thismonth') {
    // 이번 달에 정산되는 사이클들의 수입 합산
    if (!start || !end) return 0;
    let total = 0;
    let cycleStart = new Date(start);
    while (cycleStart < end) {
      let cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, cycleStart.getDate());
      if (cycleEnd > end) cycleEnd = end;
      const cycleDays = Math.max(1, Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / 86400000));
      // 정산 발생일이 이번 달인지 확인
      if (cycleStart.getFullYear() === now.getFullYear() && cycleStart.getMonth() === now.getMonth()) {
        total += Math.round(daily * cycleDays);
      }
      cycleStart = cycleEnd;
    }
    return total;
  }

  // snapshot: 전체 계약 기간 수입 = purePrice 그대로
  return m.purePrice;
}

// ─── 계정별 파티 기간(일수) ─────────────────────────────────────
function calcAccountDays(acct: Account): number {
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const m of acct.members) {
    if (!isActualPartyMember(m)) continue;
    const s = parseDate(m.startDateTime);
    const e = parseDate(m.endDateTime);
    if (s && (!earliest || s < earliest)) earliest = s;
    if (e && (!latest || e > latest)) latest = e;
  }
  if (!earliest || !latest) return 30;
  return Math.max(1, Math.ceil((latest.getTime() - earliest.getTime()) / 86400000));
}

// ─── 서비스별 수익 계산 ─────────────────────────────────────────
// 핵심: 수입은 월 단위 정산(시작일 기준 매월 N일), 구독료는 월 고정(매월), 수수료는 수입의 10%
interface ServiceProfit {
  serviceType: string;
  accountCount: number;
  partyIncome: number;       // 파티원 수입 합계 (세전)
  realizedIncome: number;    // 확정 수입 (realizedSum 합계, 수수료 전)
  dailyIncome: number;       // 일당 합계 (전체 파티원)
  commission: number;        // 수수료 (수입의 10%)
  netPartyIncome: number;    // 수입 - 수수료
  subscriptionCost: number;  // 구독료 (월 고정 × 개월수)
  extraIncome: number;       // 추가공유 수익 (토글 ON 파티만)
  extraCostTotal: number;    // 추가공유 지출 (토글 ON 파티만)
  extraProfit: number;       // 추가공유 순수익 (extraIncome - extraCostTotal)
  netProfit: number;
  avgPartyDays: number;
  accounts: (Account & { renewalDay: number | null; partyDays: number })[];
}

function calcServiceProfits(data: ManageData, mode: CalcMode, now: Date, getSubStartDayFn?: (email: string, fallback: number | null) => number | null, isExtraShareOnFn?: (email: string, svcType: string) => boolean): ServiceProfit[] {
  return data.services.map(svc => {
    const activeAccounts = svc.accounts.filter(a => a.usingCount > 0 && a.email !== '(직접전달)');
    const accountCount = activeAccounts.length;
    const unitCost = getSubscriptionCost(svc.serviceType);
    const baseExtraIncome = EXTRA_INCOME[svc.serviceType] || 0;
    const baseExtraCost = EXTRA_COST[svc.serviceType] || 0;

    // 파티원 수입 합산 (모드별)
    const partyIncome = activeAccounts.reduce((sum, acct) =>
      sum + acct.members.reduce((s, m) => s + calcMemberIncome(m, mode, now), 0), 0);

    // 확정 수입 = realizedSum 합계 (그레이태그가 이미 정산 처리한 금액)
    const realizedIncome = activeAccounts.reduce((sum, acct) =>
      sum + acct.members.reduce((s, m) => s + (m.realizedSum || 0), 0), 0);

    // 일당 합계 (표시용)
    const dailyIncome = activeAccounts.reduce((sum, acct) =>
      sum + acct.members.reduce((s, m) => s + calcDailyRate(m), 0), 0);

    // 수수료 = 수입의 10%
    const commission = Math.round(partyIncome * COMMISSION_RATE);
    const netPartyIncome = partyIncome - commission;

    // 구독료 & 추가공유 수익/지출 = 매월 고정
    // 모드에 따라 몇 개월분을 계산할지 결정
    let subscriptionCost = 0;
    let extraIncomeTotal = 0;
    let extraCostSum = 0;
    let totalPartyDays = 0;

    const enrichedAccounts = activeAccounts.map(acct => {
      const partyDays = calcAccountDays(acct);
      totalPartyDays += partyDays;

      // 이 계정의 가장 늦은 파티 종료일 확인
      let acctLatestEnd: Date | null = null;
      for (const m of acct.members) {
        if (!isActualPartyMember(m)) continue;
        if (m.endDateTime) {
          const ed = parseDate(m.endDateTime);
          if (ed && (!acctLatestEnd || ed > acctLatestEnd)) acctLatestEnd = ed;
        }
      }
      const acctAlive = !acctLatestEnd || acctLatestEnd >= now;

      // 파티별 추가공유 ON/OFF
      const extraOn = isExtraShareOnFn ? isExtraShareOnFn(acct.email, svc.serviceType) : true;
      const unitExtraIncome = extraOn ? baseExtraIncome : 0;
      const unitExtraCost = extraOn ? baseExtraCost : 0;

      if (mode === 'snapshot') {
        let acctEarliestStart: Date | null = null;
        let acctLatestEndAll: Date | null = null;
        for (const m of acct.members) {
          if (!isActualPartyMember(m)) continue;
          const sd = parseDate(m.startDateTime);
          const ed = parseDate(m.endDateTime);
          if (sd && (!acctEarliestStart || sd < acctEarliestStart)) acctEarliestStart = sd;
          if (ed && (!acctLatestEndAll || ed > acctLatestEndAll)) acctLatestEndAll = ed;
        }
        const payDay = (getSubStartDayFn && acctEarliestStart)
          ? (getSubStartDayFn(acct.email, acctEarliestStart.getDate()) ?? acctEarliestStart.getDate())
          : (acctEarliestStart ? acctEarliestStart.getDate() : 1);
        const months = (acctEarliestStart && acctLatestEndAll)
          ? Math.max(1, countPayments(acctEarliestStart, acctLatestEndAll, payDay))
          : Math.ceil(partyDays / 30);
        subscriptionCost += unitCost * months;
        extraIncomeTotal += unitExtraIncome * months;
        extraCostSum += unitExtraCost * months;
      } else if (mode === 'thismonth') {
        if (acctAlive) {
          subscriptionCost += unitCost;
          extraIncomeTotal += unitExtraIncome;
          extraCostSum += unitExtraCost;
        }
      } else if (mode === 'monthly30') {
        if (acctAlive) {
          subscriptionCost += unitCost;
          extraIncomeTotal += unitExtraIncome;
          extraCostSum += unitExtraCost;
        }
      }

      return {
        ...acct,
        renewalDay: estimateRenewalDay(acct),
        partyDays,
      };
    });

    const extraProfit = extraIncomeTotal - extraCostSum;
    // 순수익 = 총수익(netPartyIncome + extraIncome) - 파티유지비용(subscriptionCost + extraCost)
    const netProfit = (netPartyIncome + extraIncomeTotal) - (subscriptionCost + extraCostSum);
    const avgPartyDays = accountCount > 0 ? Math.round(totalPartyDays / accountCount) : 30;

    return {
      serviceType: svc.serviceType, accountCount, partyIncome, realizedIncome,
      dailyIncome, commission, netPartyIncome, subscriptionCost,
      extraIncome: extraIncomeTotal, extraCostTotal: extraCostSum, extraProfit, netProfit,
      avgPartyDays, accounts: enrichedAccounts,
    };
  }).filter(s => s.accountCount > 0);
}

// ─── 달력 이벤트 ─────────────────────────────────────────────
interface CalendarEvent {
  day: number;
  type: 'expense' | 'income' | 'extra';
  label: string;
  amount: number;
  serviceType: string;
}

function buildCalendarEvents(
  profits: ServiceProfit[],
  _mode: CalcMode,
  _now: Date,
  calYear: number,
  calMonth: number,
  getSubStartDayFn: (email: string, fallback: number | null) => number | null,
  personalSub: PersonalSubSettings,
  isExtraShareOnFn: (email: string, svcType: string) => boolean,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const monthEnd = new Date(calYear, calMonth + 1, 0, 23, 59, 59);
  const daysInMonth = monthEnd.getDate();

  // ── 개인 추가 구독 이벤트 ──
  const personalItems: { key: keyof PersonalSubSettings; label: string; dayKey: keyof PersonalSubSettings }[] = [
    { key: 'netflix', label: '넷플릭스 추가 공유 (개인)', dayKey: 'netflixDay' },
    { key: 'tving',   label: '티빙 추가 공유 (개인)',   dayKey: 'tvingDay' },
    { key: 'disney',  label: '디즈니+ 추가 공유 (개인)', dayKey: 'disneyDay' },
  ];
  for (const item of personalItems) {
    if (personalSub[item.key]) {
      const day = Math.min(personalSub[item.dayKey] as number, daysInMonth);
      events.push({
        day, type: 'expense',
        label: item.label,
        amount: PERSONAL_SUB_COSTS[item.key as string],
        serviceType: item.key as string,
      });
    }
  }

  for (const svc of profits) {
    const unitCost = getSubscriptionCost(svc.serviceType);

    for (const acct of svc.accounts) {
      // 파티별 추가공유 ON/OFF
      const extraOn = isExtraShareOnFn(acct.email, svc.serviceType);
      const unitExtraCost = extraOn ? (EXTRA_COST[svc.serviceType] || 0) : 0;
      const unitExtraIncome = extraOn ? (EXTRA_INCOME[svc.serviceType] || 0) : 0;
      // ── 이 계정의 전체 파티원 중 가장 이른 startDate / 가장 늦은 endDate ──
      let latestEnd: Date | null = null;
      let earliestStart: Date | null = null;
      for (const m of acct.members) {
        const ed = parseDate(m.endDateTime);
        const sd = parseDate(m.startDateTime);
        if (ed && (!latestEnd || ed > latestEnd)) latestEnd = ed;
        if (sd && (!earliestStart || sd < earliestStart)) earliestStart = sd;
      }

      // ── 구독 시작일: SL alias 생성일 > 커스텀 > 가장 오래된 파티원 startDay ──
      const rawFallback = earliestStart ? earliestStart.getDate() : (acct.renewalDay ?? null);
      const subStartDay = getSubStartDayFn(acct.email, rawFallback);

      if (!subStartDay || !latestEnd) continue;

      // ── 구독료/자리공유 이벤트 ──
      // 결제일 = subStartDay (매월 고정)
      // 결제 범위: earliestStart 이후 ~ latestEnd 이전 (당일 미포함)
      // 예) 3/15 시작, 6/14 종료, 결제일=15
      //   → 3/15 O, 4/15 O, 5/15 O, 6/15 X (6/14 < 6/15)  → 총 3회
      if (unitCost > 0 || unitExtraCost > 0 || unitExtraIncome > 0) {
        const thisMonthPayDate = new Date(calYear, calMonth, subStartDay);
        // 결제일이 latestEnd 보다 이전이어야 함 (latestEnd 당일 이후 결제 없음)
        const payBeforeEnd = thisMonthPayDate < latestEnd;
        // 결제일이 파티 시작 이후여야 함
        const payAfterStart = earliestStart
          ? thisMonthPayDate >= earliestStart
          : true;

        if (payBeforeEnd && payAfterStart && subStartDay <= daysInMonth) {
          const emailShort = acct.email.split('@')[0];
          const periodLabel = earliestStart && latestEnd
            ? ` (${earliestStart.getMonth()+1}/${earliestStart.getDate()}~${latestEnd.getMonth()+1}/${latestEnd.getDate()})`
            : '';

          if (unitCost > 0) {
            events.push({
              day: subStartDay, type: 'expense',
              label: `${svc.serviceType} 구독료 · ${emailShort}${periodLabel}`,
              amount: unitCost, serviceType: svc.serviceType,
            });
          }
          if (unitExtraCost > 0) {
            events.push({
              day: subStartDay, type: 'expense',
              label: `${svc.serviceType} 자리 공유 비용 · ${emailShort}`,
              amount: unitExtraCost, serviceType: svc.serviceType,
            });
          }
          if (unitExtraIncome > 0) {
            events.push({
              day: subStartDay, type: 'extra',
              label: `${svc.serviceType} 자리 공유 수입 · ${emailShort}`,
              amount: unitExtraIncome, serviceType: svc.serviceType,
            });
          }
        }
      }

      // ── 수입 이벤트: 파티원 각자 startDateTime 기준 매월 정산 ──
      for (const m of acct.members) {
        const daily = calcDailyRate(m);
        if (daily <= 0) continue;
        const start = parseDate(m.startDateTime);
        const end = parseDate(m.endDateTime);
        if (!start || !end) continue;

        let cycleStart = new Date(start);
        while (cycleStart < end) {
          let cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, cycleStart.getDate());
          if (cycleEnd > end) cycleEnd = end;

          const cycleDays = Math.max(1, Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / 86400000));
          const cycleIncome = Math.round(daily * cycleDays * (1 - COMMISSION_RATE));
          const payDay = cycleStart.getDate();
          const payDate = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), payDay);

          if (payDate.getFullYear() === calYear && payDate.getMonth() === calMonth) {
            events.push({
              day: Math.min(payDay, daysInMonth), type: 'income',
              label: `${m.name || '파티원'} · ${acct.email.split('@')[0]} (${svc.serviceType}) [${cycleDays}일분]`,
              amount: cycleIncome, serviceType: svc.serviceType,
            });
          }
          cycleStart = cycleEnd;
        }
      }
    }
  }
  return events.sort((a, b) => a.day - b.day || (a.type === 'expense' ? -1 : 1));
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────
export default function ProfitPage() {
  const cookies = loadCookies();
  const [selectedId, setSelectedId] = useState(cookies[0]?.id || '');
  const [data, setData] = useState<ManageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calcMode, setCalcMode] = useState<CalcMode>('snapshot');

  // SL alias → 생성일 맵
  const [aliasMap, setAliasMap] = useState<Record<string, number>>({}); // email -> creation day(1~31)
  const [aliasLoading, setAliasLoading] = useState(false);

  // 구독 시작일 커스터마이징
  const [subStarts, setSubStarts] = useState<Record<string, number>>(loadSubStarts);
  const [editingSubStart, setEditingSubStart] = useState<string | null>(null);
  const [subStartInput, setSubStartInput] = useState('');
  const [showSubSettings, setShowSubSettings] = useState(false);

  // 개인 추가 구독
  const [personalSub, setPersonalSub] = useState<PersonalSubSettings>(loadPersonalSub);

  // 파티별 추가공유 ON/OFF (pendingExtraShare = 저장 전 임시값)
  const [extraShare, setExtraShare] = useState<ExtraShareMap>(loadExtraShareFromStorage);
  const [pendingExtraShare, setPendingExtraShare] = useState<ExtraShareMap>(loadExtraShareFromStorage);
  const [extraShareDirty, setExtraShareDirty] = useState(false);
  const [extraShareSaved, setExtraShareSaved] = useState(false);

  // 추가공유 메모 (계정 추가공유 링크 저장)
  const [extraShareMemos, setExtraShareMemos] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('extraShareMemos') || '{}'); } catch { return {}; }
  });
  const getExtraShareMemoKey = (email: string, svcType: string) => `${email}__${svcType}`;
  const updateExtraShareMemo = (email: string, svcType: string, value: string) => {
    const key = getExtraShareMemoKey(email, svcType);
    const next = { ...extraShareMemos, [key]: value };
    setExtraShareMemos(next);
    localStorage.setItem('extraShareMemos', JSON.stringify(next));
  };

  const togglePendingExtraShare = (email: string, svcType: string) => {
    const next = _toggle(pendingExtraShare, email, svcType);
    setPendingExtraShare(next);
    setExtraShareDirty(true);
    setExtraShareSaved(false);
  };
  const saveExtraShareChanges = () => {
    setExtraShare(pendingExtraShare);
    saveExtraShareToStorage(pendingExtraShare);
    setExtraShareDirty(false);
    setExtraShareSaved(true);
    setTimeout(() => setExtraShareSaved(false), 2000);
  };
  const isExtraOn = (email: string, svcType: string) => getExtraShareOn(extraShare, email, svcType);
  const isPendingOn = (email: string, svcType: string) => getExtraShareOn(pendingExtraShare, email, svcType);

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [openSvc, setOpenSvc] = useState<string | null>(null);
  const [openAcct, setOpenAcct] = useState<string | null>(null);

  // 수동 파티원
  const [manuals, setManuals] = useState<ManualMember[]>([]);
  useEffect(() => {
    fetch('/api/manual-members')
      .then(r => r.json())
      .then((d: any) => setManuals(d.members || []))
      .catch(() => {});
  }, []);

  // SL alias 로드
  useEffect(() => {
    setAliasLoading(true);
    fetch('/api/sl/aliases?page=0')
      .then(r => r.json())
      .then((d: any) => {
        const map: Record<string, number> = {};
        (d.aliases || []).forEach((a: SLAlias) => {
          const day = new Date(a.creation_timestamp * 1000).getDate();
          map[a.email] = day;
        });
        setAliasMap(map);
      })
      .catch(() => {})
      .finally(() => setAliasLoading(false));
  }, []);

  const updatePersonalSub = (patch: Partial<PersonalSubSettings>) => {
    const next = { ...personalSub, ...patch };
    setPersonalSub(next);
    savePersonalSub(next);
  };

  const updateSubStart = (email: string, day: number) => {
    const next = { ...subStarts, [email]: day };
    setSubStarts(next);
    saveSubStarts(next);
  };

  // 이메일 → 구독 시작일(day) 결정: 커스텀 > SL alias 생성일 > 기존 로직
  const getSubStartDay = (email: string, fallback: number | null): number | null => {
    if (subStarts[email]) return subStarts[email];
    if (aliasMap[email]) return aliasMap[email];
    return fallback;
  };

  const doFetch = async (id?: string) => {
    const cs = cookies.find(c => c.id === (id || selectedId));
    if (!cs) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch('/api/my/management', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }),
      });
      const json = await res.json() as any;
      if (!res.ok) setError(json.error);
      else setData(json);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  // 자동 쿠키가 항상 있으므로 빈 상태 가드 제거됨

  const profits = data ? calcServiceProfits(data, calcMode, now, getSubStartDay, isExtraOn) : [];
  const totalPartyIncome = profits.reduce((s, p) => s + p.partyIncome, 0);
  // 총수익 = 파티수입(수수료 차감) + 추가공유 수익
  const totalIncome = profits.reduce((s, p) => s + p.netPartyIncome + p.extraIncome, 0);
  // 파티유지비용 = 구독료 + 추가공유 지출
  const totalExpense = profits.reduce((s, p) => s + p.subscriptionCost + p.extraCostTotal, 0);
  const totalCommission = profits.reduce((s, p) => s + p.commission, 0);
  // 순수익 = 총수익 - 파티유지비용
  const totalNet = totalIncome - totalExpense;
  const totalRealizedIncome = profits.reduce((s, p) => s + p.realizedIncome, 0); // 확정 수입 (수수료 전)
  const totalRealizedNet = Math.round(totalRealizedIncome * (1 - COMMISSION_RATE)); // 수수료 차감 후
  const calEvents = data ? buildCalendarEvents(profits, calcMode, now, calYear, calMonth, getSubStartDay, personalSub, isExtraOn) : [];

  // 일당 핵심 지표
  const totalDailyIncome = profits.reduce((s, p) => s + p.dailyIncome, 0); // 일 총수입
  const totalDailyCommission = Math.round(totalDailyIncome * COMMISSION_RATE); // 일 수수료
  const totalDailySub = profits.reduce((s, p) => {
    const unit = getSubscriptionCost(p.serviceType);
    return s + Math.round((unit * p.accountCount) / 30);
  }, 0); // 일 구독료 (월 구독료 ÷ 30)
  const totalDailyExtraIncome = profits.reduce((s, p) => {
    // 계정별 ON인 것만 합산
    const onCount = p.accounts.filter(a => isExtraOn(a.email, p.serviceType)).length;
    const unit = EXTRA_INCOME[p.serviceType] || 0;
    return s + Math.round((unit * onCount) / 30);
  }, 0);
  const totalDailyExtraCost = profits.reduce((s, p) => {
    const onCount = p.accounts.filter(a => isExtraOn(a.email, p.serviceType)).length;
    const unit = EXTRA_COST[p.serviceType] || 0;
    return s + Math.round((unit * onCount) / 30);
  }, 0);
  const totalDailyExtra = totalDailyExtraIncome - totalDailyExtraCost;
  const totalDailyNet = Math.round(totalDailyIncome) - totalDailyCommission - totalDailySub + totalDailyExtra;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const monthLabel = `${calYear}년 ${calMonth + 1}월`;
  const prevMonth = () => { setSelectedDay(null); if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); };
  const nextMonth = () => { setSelectedDay(null); if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); };
  const dayEvents = selectedDay ? calEvents.filter(e => e.day === selectedDay) : [];
  const monthTotalIncome = calEvents.filter(e => e.type !== 'expense').reduce((s, e) => s + e.amount, 0);
  const monthTotalExpense = calEvents.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const monthNet = monthTotalIncome - monthTotalExpense;
  const dayIncome = dayEvents.filter(e => e.type !== 'expense').reduce((s, e) => s + e.amount, 0);
  const dayExpense = dayEvents.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

  // 계산 모드 메타
  const MODE_META: Record<CalcMode, { label: string; badge: string; desc: string; color: string }> = {
    snapshot: {
      label: '전체 기간',
      badge: '전체 기간',
      desc: '파티 계약 전체 기간의 총 손익. 수입은 계약 전액, 구독료는 기간 내 월 횟수만큼.',
      color: '#7C3AED',
    },
    thismonth: {
      label: `${now.getMonth() + 1}월 실발생`,
      badge: `${now.getMonth() + 1}월`,
      desc: `이번 달에 정산되는 수입(시작일 기준 매월 정산) + 구독료 1회 + 추가수익 1회.`,
      color: '#059669',
    },
    monthly30: {
      label: '30일 환산',
      badge: '월 환산',
      desc: '일당 × 30일 수입 + 구독료 1회 + 추가수익 1회. 계약 기간 관계없이 월 단위 비교 가능.',
      color: '#2563EB',
    },
  };
  const meta = MODE_META[calcMode];

  return (
    <div style={{ padding: '20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>수익 계산</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>
            {data?.updatedAt
              ? `${new Date(data.updatedAt).getHours().toString().padStart(2, '0')}:${new Date(data.updatedAt).getMinutes().toString().padStart(2, '0')} 기준`
              : '파티 손익 분석'}
          </p>
        </div>
        <button onClick={() => doFetch()} disabled={loading} style={{
          background: '#A78BFA', border: 'none', borderRadius: 12, padding: '8px 14px',
          fontSize: 13, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
          fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
          {loading ? '조회중' : '조회'}
        </button>
      </div>

      {/* 계정 선택 */}
      {cookies.length > 1 && (
        <div className="no-scrollbar" style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto' }}>
          {cookies.map(cs => (
            <button key={cs.id} onClick={() => setSelectedId(cs.id)} style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: 'none',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: selectedId === cs.id ? '#A78BFA' : '#fff',
              color: selectedId === cs.id ? '#fff' : '#6B7280',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>{cs.label}</button>
          ))}
        </div>
      )}

      {/* 초기 안내 */}
      {!data && !loading && !error && (
        <div style={{ background: '#EDE9FE', borderRadius: 16, padding: 20, textAlign: 'center' }}>
          <Wallet size={32} color="#C4B5FD" style={{ margin: '0 auto 10px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#7C3AED' }}>조회 버튼을 눌러주세요</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>월 순수익 · 수입/지출 분석</div>
        </div>
      )}

      {error && (
        <div style={{ background: '#FFF0F0', borderRadius: 16, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#EF4444', marginBottom: 4 }}>
            <AlertCircle size={15} /> 오류
          </div>
          <div style={{ fontSize: 12, color: '#6B7280' }}>{error}</div>
          {error.includes('만료') && (
            <a href="https://graytag.co.kr/login" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, color: '#7C3AED', fontWeight: 600 }}>
              graytag.co.kr 로그인 <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} style={{ background: '#fff', borderRadius: 16, height: 80, opacity: 0.5, animation: 'pulse 1.5s infinite' }} />)}
        </div>
      )}

      {data && !loading && (
        <>
          {/* ─── 일 순수익 카드 (최상단) ─── */}
          <div style={{
            background: '#fff', borderRadius: 20, padding: '20px',
            marginBottom: 14, boxShadow: '0 2px 16px rgba(167,139,250,0.12)',
            border: '2px solid #EDE9FE',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>오늘 일 순수익</div>
              <div style={{
                fontSize: 38, fontWeight: 800, letterSpacing: -1,
                color: totalDailyNet >= 0 ? '#059669' : '#EF4444',
                lineHeight: 1,
              }}>
                {totalDailyNet >= 0 ? '+' : ''}{totalDailyNet.toLocaleString()}원
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>매일 고정비 차감 후 실제 손에 쥐는 금액</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
              <div style={{ background: '#ECFDF5', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{Math.round(totalDailyIncome).toLocaleString()}</div>
                <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>일 수입</div>
              </div>
              <div style={{ background: '#FFF0F0', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>-{totalDailyCommission.toLocaleString()}</div>
                <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>수수료</div>
              </div>
              <div style={{ background: '#FFF0F0', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>-{totalDailySub.toLocaleString()}</div>
                <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>구독료/일</div>
              </div>
              <div style={{ background: '#ECFDF5', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>+{totalDailyExtra.toLocaleString()}</div>
                <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2 }}>추가/일</div>
              </div>
            </div>
            <div style={{ marginTop: 10, background: '#F8F6FF', borderRadius: 8, padding: '6px 10px', textAlign: 'center', fontSize: 11, color: '#7C3AED', fontWeight: 600 }}>
              30일 환산 ≈ {totalDailyNet >= 0 ? '+' : ''}{(totalDailyNet * 30).toLocaleString()}원/월
            </div>
            {totalRealizedIncome > 0 && (
              <div style={{ marginTop: 6, background: '#ECFDF5', borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>✓ 확정 수입 (정산완료)</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>+{totalRealizedIncome.toLocaleString()}원</span>
              </div>
            )}
          </div>

          {/* ─── 계산 방식 선택 탭 ─── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {(['snapshot', 'thismonth', 'monthly30'] as CalcMode[]).map(m => (
              <button key={m} onClick={() => setCalcMode(m)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 10, border: 'none',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: calcMode === m ? MODE_META[m].color : '#F3F0FF',
                color: calcMode === m ? '#fff' : '#6B7280',
                transition: 'all 0.15s',
              }}>
                {MODE_META[m].label}
              </button>
            ))}
          </div>

          {/* 계산 방식 설명 */}
          <div style={{
            background: '#F8F6FF', borderRadius: 10, padding: '8px 12px', marginBottom: 12,
            display: 'flex', alignItems: 'flex-start', gap: 7,
            border: `1px solid ${meta.color}22`,
          }}>
            <Info size={13} color={meta.color} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700, color: meta.color }}>{meta.badge}</span>{'  '}
              {meta.desc}
            </span>
          </div>

          {/* ─── 요약 배너 ─── */}
          <div style={{
            background: totalNet >= 0
              ? 'linear-gradient(135deg, #059669 0%, #10B981 100%)'
              : 'linear-gradient(135deg, #DC2626 0%, #EF4444 100%)',
            borderRadius: 20, padding: '18px 20px', marginBottom: 14, color: '#fff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 12, opacity: 0.85 }}>월 예상 순수익</span>
              <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>
                {meta.badge}
              </span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>
              {totalNet >= 0 ? '+' : ''}{totalNet.toLocaleString()}원
            </div>

            {/* 3가지 방식 비교 (다른 2개 미리보기) */}
            {(() => {
              const others = (['snapshot', 'thismonth', 'monthly30'] as CalcMode[]).filter(m => m !== calcMode);
              return (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {others.map(m => {
                    const op = calcServiceProfits(data, m, now, getSubStartDay, isExtraOn);
                    const oNet = op.reduce((s, p) => s + (p.netPartyIncome + p.extraIncome) - (p.subscriptionCost + p.extraCostTotal), 0);
                    return (
                      <button key={m} onClick={() => setCalcMode(m)} style={{
                        flex: 1, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
                        borderRadius: 10, padding: '7px 6px', cursor: 'pointer',
                        fontFamily: 'inherit', textAlign: 'center',
                      }}>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginBottom: 2 }}>{MODE_META[m].badge}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                          {oNet >= 0 ? '+' : ''}{oNet.toLocaleString()}원
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
              {[
                { icon: <ArrowUpRight size={12} />, label: '총수익', value: fmtMoneyPlain(totalIncome) },
                { icon: <ArrowDownRight size={12} />, label: '파티유지비용', value: fmtMoneyPlain(totalExpense) },
                { icon: <Minus size={12} />, label: '수수료(10%)', value: fmtMoneyPlain(totalCommission) },
              ].map(item => (
                <div key={item.label} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 4px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                    {item.icon}
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{item.value}</span>
                  </div>
                  <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ─── 서비스별 상세 ─── */}
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', marginBottom: 10 }}>서비스별 손익</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {profits.map(svc => {
              const sc = svcColor(svc.serviceType);
              const logo = svcLogo(svc.serviceType);
              const isPositive = svc.netProfit >= 0;
              return (
                <div key={svc.serviceType} style={{
                  background: '#fff', borderRadius: 16, overflow: 'hidden',
                  boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: `1.5px solid ${sc.bg}`,
                }}>
                  <button onClick={() => setOpenSvc(openSvc === svc.serviceType ? null : svc.serviceType)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #F3F0FF', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: sc.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {logo && <img src={logo} alt={svc.serviceType} style={{ width: 26, height: 26, objectFit: 'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B' }}>{svc.serviceType}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>계정 {svc.accountCount}개 · 평균 {svc.avgPartyDays}일</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: isPositive ? '#059669' : '#EF4444', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                        {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {fmtMoney(svc.netProfit)}
                      </div>
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                        {meta.badge} 순수익
                      </div>
                    </div>
                    {openSvc === svc.serviceType ? <ChevronDown size={16} color="#A78BFA" /> : <ChevronRight size={16} color="#A78BFA" />}
                  </button>
                  <div style={{ padding: '10px 16px 14px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* 일당 + 확정수입 표시 */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 2 }}>
                        <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '5px 8px' }}>
                          <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 1 }}>일당 수입</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{Math.round(svc.dailyIncome).toLocaleString()}원</div>
                        </div>
                        <div style={{ background: '#ECFDF5', borderRadius: 8, padding: '5px 8px' }}>
                          <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 1 }}>확정 수입</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{svc.realizedIncome.toLocaleString()}원</div>
                        </div>
                      </div>
                      {[
                        { label: `파티원 수입 (${meta.badge})`, value: svc.partyIncome, sign: 1 },
                        { label: `수수료 (10%)`, value: svc.commission, sign: -1 },
                        ...(svc.extraIncome > 0 ? [{ label: `추가공유 수익`, value: svc.extraIncome, sign: 1 }] : []),
                        ...(svc.subscriptionCost > 0 ? [{ label: `구독료 (${fmtMoneyPlain(getSubscriptionCost(svc.serviceType))}/월 × ${svc.accountCount}개${calcMode === 'snapshot' ? ' × ' + (getSubscriptionCost(svc.serviceType) > 0 ? Math.round(svc.subscriptionCost / getSubscriptionCost(svc.serviceType) / svc.accountCount) : Math.ceil(svc.avgPartyDays/30)) + '개월' : ''})`, value: svc.subscriptionCost, sign: -1 }] : []),
                        ...(svc.extraCostTotal > 0 ? [{ label: `추가공유 지출`, value: svc.extraCostTotal, sign: -1 }] : []),
                      ].map((row, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {row.sign > 0 ? <ArrowUpRight size={11} color="#059669" /> : <ArrowDownRight size={11} color="#EF4444" />}
                            {row.label}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: row.sign > 0 ? '#059669' : '#EF4444' }}>
                            {row.sign > 0 ? '+' : '-'}{row.value.toLocaleString()}원
                          </span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px dashed #E9E4FF', paddingTop: 6, marginTop: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#1E1B4B' }}>소계 ({meta.badge})</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: isPositive ? '#059669' : '#EF4444' }}>{fmtMoney(svc.netProfit)}</span>
                      </div>
                    </div>
                  </div>
                  {/* ── 계정 & 파티원 드릴다운 ── */}
                  {openSvc === svc.serviceType && (
                    <div style={{ borderTop: '1px solid #F3F0FF', padding: '8px 12px 12px' }}>
                      {svc.accounts.map(acct => {
                        const acctKey = `profit__${acct.email}__${svc.serviceType}`;
                        const isAcctOpen = openAcct === acctKey;
                        const activeMembers = acct.members.filter(m => ACTIVE_SET.has(m.status));
                        const manualCount = getActiveManualCount(manuals, svc.serviceType, acct.email);
                        const totalUsing = (acct.usingCount || 0) + manualCount;
                        const filledSlots = totalUsing;
                        const totalSlots = Math.max(acct.totalSlots, filledSlots, 1);
                        const acctDaily = acct.members.reduce((s, m) => s + calcDailyRate(m), 0);
                        const alias = emailAlias(acct.email);
                        // 활성 수동 파티원 목록 (드릴다운에 표시용)
                        const today = new Date().toISOString().split('T')[0];
                        const activeManuals = manuals.filter(mm =>
                          mm.serviceType === svc.serviceType &&
                          mm.accountEmail === acct.email &&
                          mm.status !== 'cancelled' &&
                          mm.startDate <= today &&
                          mm.endDate >= today
                        );
                        return (
                          <div key={acctKey} style={{ marginBottom: 8, background: '#F8F6FF', borderRadius: 12, overflow: 'hidden' }}>
                            <button onClick={() => setOpenAcct(isAcctOpen ? null : acctKey)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                              {/* 슬롯 게이지 */}
                              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 36 }}>
                                <div style={{ display: 'flex', gap: 3 }}>
                                  {Array.from({length: totalSlots}).map((_, i) => (
                                    <div key={i} style={{
                                      width: i < totalUsing ? 7 : 6,
                                      height: i < totalUsing ? 18 : 14,
                                      borderRadius: 3,
                                      background: i < acct.usingCount ? '#A78BFA' : i < totalUsing ? '#34D399' : i < acct.activeCount ? '#C4B5FD' : '#E9E4FF',
                                      alignSelf: 'flex-end'
                                    }} />
                                  ))}
                                </div>
                                <div style={{ fontSize: 9, color: '#9CA3AF' }}>{totalUsing}/{totalSlots}</div>
                              </div>
                              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Mail size={12} color="#9CA3AF" />
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>{alias}</span>
                                  {manualCount > 0 && (
                                    <span style={{ fontSize: 9, background: '#D1FAE5', color: '#059669', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>+{manualCount}수동</span>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>일당 {Math.round(acctDaily).toLocaleString()}원</span>
                                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>{Math.round(acctDaily * (1 - COMMISSION_RATE) * 30).toLocaleString()}원/월</span>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>{fmtMoneyPlain(acct.totalIncome)}</div>
                              </div>
                              {isAcctOpen ? <ChevronDown size={13} color="#C4B5FD" /> : <ChevronRight size={13} color="#C4B5FD" />}
                            </button>
                            {isAcctOpen && (
                              <div style={{ borderTop: '1px solid #EDE9FE', padding: '8px 14px' }}>
                                {activeMembers.length === 0 && activeManuals.length === 0 ? (
                                  <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', padding: '8px 0' }}>활성 파티원 없음</div>
                                ) : (
                                  <>
                                    {activeMembers.map((m, idx) => {
                                      const b = bge(m.status, m.statusName);
                                      const isUsing = USING_SET.has(m.status);
                                      const daily = calcDailyRate(m);
                                      return (
                                        <div key={m.dealUsid} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: '1px solid #F3F0FF' }}>
                                          <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: isUsing ? '#A78BFA' : '#C4B5FD', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, marginTop: 2, color: '#fff' }}>{idx + 1}</div>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                              <span style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>{m.name || '(미확인)'}</span>
                                              <span style={{ fontSize: 10, fontWeight: 600, color: b.color, background: b.bg, borderRadius: 6, padding: '2px 7px' }}>{b.label}</span>
                                            </div>
                                            {(m.startDateTime || m.endDateTime) && (
                                              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                                                {m.startDateTime && fmtDate(m.startDateTime)}{m.startDateTime && m.endDateTime && ' ~ '}{m.endDateTime && fmtDate(m.endDateTime)}{m.remainderDays > 0 && ` (${m.remainderDays}일)`}
                                              </div>
                                            )}
                                            {daily > 0 && (
                                              <div style={{ fontSize: 10, color: '#059669', marginTop: 2, fontWeight: 600 }}>
                                                일당 {Math.round(daily).toLocaleString()}원 · 수수료 후 {Math.round(daily * (1 - COMMISSION_RATE)).toLocaleString()}원/일
                                              </div>
                                            )}
                                            {isUsing && m.progressRatio && m.progressRatio !== '0%' && (
                                              <div style={{ marginTop: 5 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9CA3AF', marginBottom: 2 }}><span>진행률</span><span>{m.progressRatio}</span></div>
                                                <div style={{ background: '#E9E4FF', borderRadius: 4, height: 4 }}><div style={{ background: '#A78BFA', borderRadius: 4, height: '100%', width: m.progressRatio, maxWidth: '100%' }} /></div>
                                              </div>
                                            )}
                                          </div>
                                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>{m.price}</div>
                                            {m.realizedSum > 0 && <div style={{ fontSize: 10, color: '#059669', marginTop: 2 }}>정산 {m.realizedSum.toLocaleString()}원</div>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                    {/* 수동 파티원 */}
                                    {activeManuals.map((mm, idx) => (
                                      <div key={mm.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: idx < activeManuals.length - 1 ? '1px solid #F3F0FF' : 'none' }}>
                                        <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, marginTop: 2, color: '#fff' }}>{activeMembers.length + idx + 1}</div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>{mm.memberName}</span>
                                            <span style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: '#D1FAE5', borderRadius: 6, padding: '2px 7px' }}>수동</span>
                                            {mm.source && <span style={{ fontSize: 10, color: '#9CA3AF' }}>{mm.source}</span>}
                                          </div>
                                          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                                            {mm.startDate} ~ {mm.endDate}
                                          </div>
                                          {mm.memo && <div style={{ fontSize: 10, color: '#A78BFA', marginTop: 1 }}>{mm.memo}</div>}
                                        </div>
                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>{mm.price.toLocaleString()}원</div>
                                        </div>
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {profits.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#9CA3AF', fontSize: 13 }}>활성 파티가 없어요</div>
            )}
          </div>

          {/* ─── 달력 ─── */}
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={16} color="#A78BFA" /> 월간 결제/수입 캘린더
          </div>
          <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #F3F0FF' }}>
              <button onClick={prevMonth} style={{ background: '#F3F0FF', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
                <ChevronLeft size={16} color="#7C3AED" />
              </button>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{monthLabel}</span>
              <button onClick={nextMonth} style={{ background: '#F3F0FF', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
                <ChevronRight size={16} color="#7C3AED" />
              </button>
            </div>
            {calEvents.length > 0 && (
              <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid #F3F0FF' }}>
                <div style={{ flex: 1, background: '#ECFDF5', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#6B7280' }}>수입</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>+{monthTotalIncome.toLocaleString()}</div>
                </div>
                <div style={{ flex: 1, background: '#FFF0F0', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#6B7280' }}>지출</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>-{monthTotalExpense.toLocaleString()}</div>
                </div>
                <div style={{ flex: 1, background: monthNet >= 0 ? '#F0FDF4' : '#FFF0F0', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#6B7280' }}>순수익</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: monthNet >= 0 ? '#059669' : '#EF4444' }}>{monthNet >= 0 ? '+' : ''}{monthNet.toLocaleString()}</div>
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '8px 8px 4px' }}>
              {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: d === '일' ? '#EF4444' : d === '토' ? '#2563EB' : '#9CA3AF', padding: '2px 0' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 8px 10px', gap: 2 }}>
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const de = calEvents.filter(e => e.day === day);
                const hasExp = de.some(e => e.type === 'expense');
                const hasInc = de.some(e => e.type === 'income' || e.type === 'extra');
                const isSel = selectedDay === day;
                const isToday = day === now.getDate() && calMonth === now.getMonth() && calYear === now.getFullYear();
                return (
                  <button key={day} onClick={() => setSelectedDay(isSel ? null : day)} style={{
                    background: isSel ? '#A78BFA' : isToday ? '#F3F0FF' : 'none',
                    border: 'none', borderRadius: 10, padding: '6px 2px',
                    cursor: de.length > 0 ? 'pointer' : 'default',
                    fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minHeight: 42,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: isToday || isSel ? 700 : 400, color: isSel ? '#fff' : isToday ? '#7C3AED' : '#1E1B4B' }}>
                      {day}
                    </span>
                    {de.length > 0 && (() => {
                      const dInc = de.filter(e => e.type !== 'expense').reduce((s,e) => s+e.amount, 0);
                      const dExp = de.filter(e => e.type === 'expense').reduce((s,e) => s+e.amount, 0);
                      return (
                        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                          {dInc > 0 && <div style={{ fontSize:7, fontWeight:700, color: isSel?'#6EE7B7':'#059669', lineHeight:1 }}>+{(dInc/1000).toFixed(dInc%1000===0?0:1)}k</div>}
                          {dExp > 0 && <div style={{ fontSize:7, fontWeight:700, color: isSel?'#FCA5A5':'#EF4444', lineHeight:1 }}>-{(dExp/1000).toFixed(dExp%1000===0?0:1)}k</div>}
                        </div>
                      );
                    })()}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '0 16px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} /> 지출
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669' }} /> 수입
              </div>
            </div>
          </div>

          {/* 선택된 날짜 상세 */}
          {selectedDay && dayEvents.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 14, boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{calMonth + 1}월 {selectedDay}일</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {dayIncome > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', background: '#ECFDF5', borderRadius: 6, padding: '2px 8px' }}>+{dayIncome.toLocaleString()}</span>}
                  {dayExpense > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#EF4444', background: '#FFF0F0', borderRadius: 6, padding: '2px 8px' }}>-{dayExpense.toLocaleString()}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayEvents.map((evt, i) => {
                  const isExp = evt.type === 'expense';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8F6FF', borderRadius: 10, padding: '8px 12px' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: isExp ? '#EF4444' : '#059669' }} />
                      <div style={{ flex: 1, fontSize: 12, color: '#1E1B4B' }}>{evt.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isExp ? '#EF4444' : '#059669' }}>
                        {isExp ? '-' : '+'}{evt.amount.toLocaleString()}원
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {selectedDay && dayEvents.length === 0 && (
            <div style={{ background: '#fff', borderRadius: 16, padding: '20px 16px', marginBottom: 14, textAlign: 'center', color: '#9CA3AF', fontSize: 13, boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE' }}>
              {calMonth + 1}월 {selectedDay}일에는 예정된 결제/수입이 없어요
            </div>
          )}

          {/* ─── 구독 설정 (파티 구독일 + 개인 추가 구독 통합) ─── */}
          {profits.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE', marginBottom: 14 }}>
              <button
                onClick={() => setShowSubSettings(v => !v)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <Settings size={16} color="#A78BFA" />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B', flex: 1, textAlign: 'left' }}>구독 설정</span>
                {aliasLoading && <Loader2 size={13} color="#9CA3AF" style={{ animation: 'spin 1s linear infinite' }} />}
                {!aliasLoading && Object.keys(aliasMap).length > 0 && (
                  <span style={{ fontSize: 11, background: '#ECFDF5', color: '#059669', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>SL연동</span>
                )}
                {(personalSub.netflix || personalSub.tving || personalSub.disney) && (
                  <span style={{ fontSize: 11, background: '#EDE9FE', color: '#7C3AED', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                    개인 -{[['netflix',personalSub.netflix],['tving',personalSub.tving],['disney',personalSub.disney]].filter(([,v])=>v).reduce((s,[k])=>s+PERSONAL_SUB_COSTS[k as string],0).toLocaleString()}원
                  </span>
                )}
                {showSubSettings ? <ChevronDown size={15} color="#A78BFA" /> : <ChevronRight size={15} color="#A78BFA" />}
              </button>

              {showSubSettings && (
                <div style={{ borderTop: '1px solid #F3F0FF', padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* 추가공유 저장 버튼 */}
                  {extraShareDirty && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFFBEB", borderRadius: 10, padding: "8px 12px", border: "1px solid #FDE68A" }}>
                      <span style={{ fontSize: 12, color: "#D97706", flex: 1, fontWeight: 600 }}>추가공유 설정이 변경됐어요</span>
                      <button
                        onClick={saveExtraShareChanges}
                        style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}
                      >
                        <Check size={13} strokeWidth={3} /> 저장
                      </button>
                    </div>
                  )}
                  {extraShareSaved && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#ECFDF5", borderRadius: 10, padding: "8px 12px" }}>
                      <Check size={13} color="#059669" strokeWidth={3} />
                      <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>저장 완료! 수익 계산에 반영됐어요</span>
                    </div>
                  )}
                  {/* 안내 텍스트 */}
                  <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.6 }}>
                    각 파티 이메일의 구독 시작일(캘린더 지출 기준일)을 설정해요.<br />
                    <span style={{ color: '#059669', fontWeight: 600 }}>● SL</span> = SimpleLogin 계정 생성일 자동 적용 &nbsp;
                    <span style={{ color: '#7C3AED', fontWeight: 600 }}>● 직접</span> = 커스텀 설정
                  </div>

                  {/* ── 파티별 구독일 + 총 지출 ── */}
                  {profits.map(svc => {
                      const sortedAccts = [...svc.accounts].sort((a, b) => {
                        const getDay = (ac: any) => {
                          const aDay = subStarts[ac.email] || aliasMap[ac.email];
                          if (aDay) return aDay;
                          let earliest: Date | null = null;
                          for (const m of ac.members) {
                            const sd = parseDate(m.startDateTime);
                            if (sd && (!earliest || sd < earliest)) earliest = sd;
                          }
                          return earliest ? earliest.getDate() : (ac.renewalDay ?? 1);
                        };
                        return getDay(a) - getDay(b);
                      });
                      const { color: svcClrHeader } = svcColor(svc.serviceType);
                      const logoHeader = svcLogo(svc.serviceType);
                      return (
                        <div key={svc.serviceType} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {/* 서비스 카테고리 헤더 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px' }}>
                            {logoHeader && <img src={logoHeader} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'contain' }} />}
                            <span style={{ fontSize: 12, fontWeight: 700, color: svcClrHeader }}>{svc.serviceType}</span>
                            <span style={{ fontSize: 10, color: '#C4B5FD' }}>{svc.accounts.length}개 계정</span>
                          </div>
                          {sortedAccts.map(acct => {
                    const aliasDay = aliasMap[acct.email];
                    const customDay = subStarts[acct.email];
                    const rawFallback = (() => {
                      let earliest: Date | null = null;
                      for (const m of acct.members) {
                        const sd = parseDate(m.startDateTime);
                        if (sd && (!earliest || sd < earliest)) earliest = sd;
                      }
                      return earliest ? earliest.getDate() : (acct.renewalDay ?? null);
                    })();
                    const effectiveDay = customDay || aliasDay || rawFallback || 1;
                    const source = customDay ? '직접' : aliasDay ? 'SL' : '자동';
                    const srcColor = customDay ? '#7C3AED' : aliasDay ? '#059669' : '#9CA3AF';
                    const isEditing = editingSubStart === acct.email;

                    // 총 구독 지출 계산: earliestStart ~ latestEnd 기간 동안 effectiveDay에 결제 발생 횟수
                    let latestEnd: Date | null = null;
                    let earliestStart: Date | null = null;
                    for (const m of acct.members) {
                      const ed = parseDate(m.endDateTime);
                      const sd = parseDate(m.startDateTime);
                      if (ed && (!latestEnd || ed > latestEnd)) latestEnd = ed;
                      if (sd && (!earliestStart || sd < earliestStart)) earliestStart = sd;
                    }
                    const unitCost = getSubscriptionCost(svc.serviceType);
                    const unitExtraCost = EXTRA_COST[svc.serviceType] || 0;
                    const perPayment = unitCost + unitExtraCost;

                    // countPayments 헬퍼로 정확한 결제 횟수 계산
                    const payCount = (earliestStart && latestEnd)
                      ? countPayments(earliestStart, latestEnd, effectiveDay)
                      : 0;
                    const totalSubCost = perPayment * payCount;

                    // 결제 날짜 목록 생성 (지난/미래 구분용)
                    const payDates: Date[] = [];
                    if (earliestStart && latestEnd && payCount > 0) {
                      let y = earliestStart.getFullYear(), mo = earliestStart.getMonth();
                      const endY = latestEnd.getFullYear(), endMo = latestEnd.getMonth();
                      while (y < endY || (y === endY && mo <= endMo)) {
                        const daysInMo = new Date(y, mo + 1, 0).getDate();
                        const pd = new Date(y, mo, Math.min(effectiveDay, daysInMo));
                        if (pd >= earliestStart && pd < latestEnd) payDates.push(pd);
                        mo++; if (mo > 11) { mo = 0; y++; }
                      }
                    }
                    const periodStr = earliestStart && latestEnd
                      ? `${earliestStart.getMonth()+1}/${earliestStart.getDate()}~${latestEnd.getMonth()+1}/${latestEnd.getDate()}`
                      : null;

                    const logo = svcLogo(svc.serviceType);
                    const { color: svcClr } = svcColor(svc.serviceType);

                    return (
                      <div key={acct.email} style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* 이메일 + 서비스 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {logo && <img src={logo} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'contain' }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {emailAlias(acct.email)}
                              {emailAlias(acct.email) !== acct.email && <span style={{ fontSize: 9, color: '#C4B5FD', marginLeft: 4, fontWeight: 400 }}>{acct.email.length > 20 ? acct.email.slice(0,20)+'…' : acct.email}</span>}
                            </div>
                            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ color: srcColor, fontWeight: 600 }}>● {source}</span>
                              {aliasDay && !customDay && <span>SL 가입일: {aliasDay}일</span>}
                              {customDay && <span>커스텀: {customDay}일</span>}
                              {periodStr && <span style={{ color: '#C4B5FD' }}>· {periodStr}</span>}
                            </div>
                          </div>
                          {/* 총 지출 요약 */}
                          {payCount > 0 && (
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>-{totalSubCost.toLocaleString()}원</div>
                              <div style={{ fontSize: 10, color: '#9CA3AF' }}>{payCount}회 × {perPayment.toLocaleString()}원</div>
                            </div>
                          )}
                        </div>

                        {/* 구독일 설정 행 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: '#9CA3AF', flex: 1 }}>매월 결제일</span>
                          {isEditing ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="number" min={1} max={28}
                                value={subStartInput}
                                onChange={e => setSubStartInput(e.target.value)}
                                autoFocus
                                style={{ width: 50, padding: '4px 6px', borderRadius: 7, border: '1.5px solid #A78BFA', fontSize: 13, textAlign: 'center', fontFamily: 'inherit', color: '#1E1B4B' }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    const v = Math.max(1, Math.min(28, parseInt(subStartInput) || 1));
                                    updateSubStart(acct.email, v);
                                    setEditingSubStart(null);
                                  } else if (e.key === 'Escape') {
                                    setEditingSubStart(null);
                                  }
                                }}
                              />
                              <span style={{ fontSize: 11, color: '#9CA3AF' }}>일</span>
                              <button onClick={() => {
                                const v = Math.max(1, Math.min(28, parseInt(subStartInput) || 1));
                                updateSubStart(acct.email, v);
                                setEditingSubStart(null);
                              }} style={{ background: '#A78BFA', border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}>
                                <Check size={12} color="#fff" strokeWidth={3} />
                              </button>
                              <button onClick={() => setEditingSubStart(null)} style={{ background: '#F3F0FF', border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}>
                                <X size={12} color="#9CA3AF" />
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: '#A78BFA' }}>{effectiveDay}일</span>
                              <button onClick={() => { setEditingSubStart(acct.email); setSubStartInput(String(effectiveDay)); }} style={{ background: '#EDE9FE', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                <Pencil size={11} color="#7C3AED" />
                              </button>
                              {customDay && (
                                <button onClick={() => {
                                  const next = { ...subStarts };
                                  delete next[acct.email];
                                  setSubStarts(next);
                                  saveSubStarts(next);
                                }} style={{ background: '#FFF0F0', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                  <X size={11} color="#EF4444" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 결제 날짜 목록 */}
                        {payDates.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {payDates.map((pd, i) => {
                              const isPast = pd < now;
                              return (
                                <span key={i} style={{
                                  fontSize: 10, fontWeight: 600,
                                  padding: '2px 7px', borderRadius: 20,
                                  background: isPast ? '#ECFDF5' : '#FFF0F0',
                                  color: isPast ? '#059669' : '#EF4444',
                                  border: `1px solid ${isPast ? '#A7F3D0' : '#FECACA'}`,
                                }}>
                                  {pd.getMonth()+1}/{pd.getDate()}
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* 파티별 추가공유 ON/OFF */}
                        {(EXTRA_INCOME[svc.serviceType] || EXTRA_COST[svc.serviceType]) ? (
                          <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: isPendingOn(acct.email, svc.serviceType) ? '#F0FDF4' : '#F9FAFB', borderRadius: 8, padding: '7px 10px' }}>
                            <span style={{ fontSize: 11, color: '#6B7280', flex: 1 }}>
                              추가공유
                              {EXTRA_INCOME[svc.serviceType] ? <span style={{ color: '#059669', fontWeight: 600 }}> +{EXTRA_INCOME[svc.serviceType].toLocaleString()}</span> : ''}
                              {EXTRA_COST[svc.serviceType] ? <span style={{ color: '#EF4444' }}> / -{EXTRA_COST[svc.serviceType].toLocaleString()}</span> : ''}
                            </span>
                            <button
                              onClick={() => togglePendingExtraShare(acct.email, svc.serviceType)}
                              style={{
                                width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                                background: isPendingOn(acct.email, svc.serviceType) ? '#059669' : '#D1D5DB',
                                position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                              }}
                            >
                              <div style={{
                                position: 'absolute', top: 3, left: isPendingOn(acct.email, svc.serviceType) ? 20 : 3,
                                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                              }} />
                            </button>
                            <span style={{ fontSize: 10, color: isPendingOn(acct.email, svc.serviceType) ? '#059669' : '#9CA3AF', fontWeight: 600, minWidth: 20 }}>
                              {isPendingOn(acct.email, svc.serviceType) ? 'ON' : 'OFF'}
                            </span>
                          </div>
                          {/* 추가공유 ON일 때 계정 링크 메모 */}
                          {isPendingOn(acct.email, svc.serviceType) && (
                            <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>📋 계정 추가공유 링크</span>
                              <input
                                type="text"
                                value={extraShareMemos[getExtraShareMemoKey(acct.email, svc.serviceType)] || ''}
                                onChange={e => updateExtraShareMemo(acct.email, svc.serviceType, e.target.value)}
                                placeholder="추가공유 초대 링크를 붙여넣으세요"
                                style={{
                                  width: '100%', fontSize: 11, padding: '5px 8px', borderRadius: 6,
                                  border: '1px solid #A7F3D0', outline: 'none', background: '#fff',
                                  color: '#1E1B4B', boxSizing: 'border-box',
                                }}
                              />
                              {extraShareMemos[getExtraShareMemoKey(acct.email, svc.serviceType)] && (
                                <a
                                  href={extraShareMemos[getExtraShareMemoKey(acct.email, svc.serviceType)]}
                                  target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: 10, color: '#059669', textDecoration: 'underline', wordBreak: 'break-all' }}
                                >
                                  링크 열기 →
                                </a>
                              )}
                            </div>
                          )}
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                        </div>
                      );
                    })}

                  {/* ── 구분선 ── */}
                  <div style={{ height: 1, background: '#EDE9FE', margin: '2px 0' }} />

                  {/* ── 개인 추가 구독 (공통) ── */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED', marginBottom: 2 }}>
                    개인 추가 공유 구독
                    {(personalSub.netflix || personalSub.tving || personalSub.disney) && (
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}>
                        월 -{[['netflix',personalSub.netflix],['tving',personalSub.tving],['disney',personalSub.disney]].filter(([,v])=>v).reduce((s,[k])=>s+PERSONAL_SUB_COSTS[k as string],0).toLocaleString()}원
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: -6, marginBottom: 2 }}>내가 직접 결제하는 OTT 추가 공유 비용 (캘린더 지출에 반영)</div>
                  {([
                    { key: 'netflix' as const, dayKey: 'netflixDay' as const, label: '넷플릭스 추가 공유', cost: PERSONAL_SUB_COSTS.netflix, color: '#E50914' },
                    { key: 'tving'   as const, dayKey: 'tvingDay'   as const, label: '티빙 추가 공유',   cost: PERSONAL_SUB_COSTS.tving,   color: '#FF153C' },
                    { key: 'disney'  as const, dayKey: 'disneyDay'  as const, label: '디즈니+ 추가 공유', cost: PERSONAL_SUB_COSTS.disney,  color: '#1A3E8C' },
                  ] as const).map(item => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8F6FF', borderRadius: 10, padding: '9px 12px' }}>
                      <button
                        onClick={() => updatePersonalSub({ [item.key]: !personalSub[item.key] } as any)}
                        style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${personalSub[item.key] ? item.color : '#D1D5DB'}`, background: personalSub[item.key] ? item.color : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                      >
                        {personalSub[item.key] && <Check size={13} color="#fff" strokeWidth={3} />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B' }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{item.cost.toLocaleString()}원/월</div>
                      </div>
                      {personalSub[item.key] && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: '#9CA3AF' }}>결제일</span>
                          <input
                            type="number" min={1} max={28}
                            value={personalSub[item.dayKey]}
                            onChange={e => {
                              const v = Math.max(1, Math.min(28, parseInt(e.target.value) || 1));
                              updatePersonalSub({ [item.dayKey]: v } as any);
                            }}
                            style={{ width: 44, padding: '4px 6px', borderRadius: 6, border: '1.5px solid #EDE9FE', fontSize: 12, textAlign: 'center', fontFamily: 'inherit', color: '#1E1B4B', background: '#fff' }}
                          />
                          <span style={{ fontSize: 11, color: '#9CA3AF' }}>일</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* 계산 기준 안내 */}
          <div style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 14px', marginBottom: 20, fontSize: 11, color: '#9CA3AF', lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600, color: '#7C3AED', marginBottom: 4 }}>계산 기준</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div><span style={{ color: '#7C3AED', fontWeight: 600 }}>현재 스냅샷</span> — 파티 전체 기간의 총 손익. 구독료는 기간 내 월 수만큼 차감.</div>
              <div><span style={{ color: '#059669', fontWeight: 600 }}>{now.getMonth() + 1}월 실발생</span> — 이번 달 정산되는 사이클 수입 합산 + 구독료 1회 + 추가수익 1회</div>
              <div><span style={{ color: '#2563EB', fontWeight: 600 }}>30일 환산</span> — 일당 × 30일 + 구독료 1회 + 추가수익 1회 (월 기준 정규화)</div>
              <div style={{ borderTop: '1px solid #EDE9FE', paddingTop: 4, marginTop: 2 }}>
                수입: 월 단위 정산 (시작일 기준 매월 N일에 한 달치 정산)<br />
                수수료: 수입의 10% (정산 시 차감)<br />
                구독료: 넷플 17,000/월 · 디즈니+ 18,000/월 · 웨이브+티빙 번들 19,000/월 (매월 고정)<br />
                자리 공유: 티빙 -15,000+24,000/월 · 넷플 -10,000+18,000/월 · 디즈니+ +5,000/월 · 왓챠 +12,000/월<br />
                구독일: SimpleLogin 가입일 자동 적용 (캘린더 아래 설정에서 수정 가능)
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ height: 20 }} />
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }
      `}</style>
    </div>
  );
}


// ─── MonthlyCalendarWidget: 홈에서도 사용 가능한 캘린더+구독설정 ─────────
export function MonthlyCalendarWidget({ data }: { data: ManageData }) {
  const now = new Date();
  const [aliasMap, setAliasMap] = useState<Record<string, number>>({});
  const [aliasLoading, setAliasLoading] = useState(false);
  const [subStarts, setSubStarts] = useState<Record<string, number>>(loadSubStarts);
  const [editingSubStart, setEditingSubStart] = useState<string | null>(null);
  const [subStartInput, setSubStartInput] = useState('');
  const [showSubSettings, setShowSubSettings] = useState(false);
  const [personalSub, setPersonalSub] = useState<PersonalSubSettings>(loadPersonalSub);
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [manuals, setManuals] = useState<ManualMember[]>([]);

  useEffect(() => {
    fetch('/api/manual-members')
      .then(r => r.json())
      .then((d: any) => setManuals(d.members || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setAliasLoading(true);
    fetch('/api/sl/aliases?page=0')
      .then(r => r.json())
      .then((d: any) => {
        const map: Record<string, number> = {};
        (d.aliases || []).forEach((a: SLAlias) => {
          map[a.email] = new Date(a.creation_timestamp * 1000).getDate();
        });
        setAliasMap(map);
      })
      .catch(() => {})
      .finally(() => setAliasLoading(false));
  }, []);

  const updatePersonalSub = (patch: Partial<PersonalSubSettings>) => {
    const next = { ...personalSub, ...patch };
    setPersonalSub(next);
    savePersonalSub(next);
  };

  const updateSubStart = (email: string, day: number) => {
    const next = { ...subStarts, [email]: day };
    setSubStarts(next);
    saveSubStarts(next);
  };

  const getSubStartDay = (email: string, fallback: number | null): number | null => {
    if (subStarts[email]) return subStarts[email];
    if (aliasMap[email]) return aliasMap[email];
    return fallback;
  };

  // 홈에서도 저장된 extraShare 반영
  const [extraShareWidget, setExtraShareWidget] = useState<ExtraShareMap>(loadExtraShareFromStorage);
  const [pendingExtraShareWidget, setPendingExtraShareWidget] = useState<ExtraShareMap>(loadExtraShareFromStorage);
  const [extraShareWidgetDirty, setExtraShareWidgetDirty] = useState(false);
  const [extraShareWidgetSaved, setExtraShareWidgetSaved] = useState(false);
  const togglePendingWidget = (email: string, svcType: string) => {
    const next = _toggle(pendingExtraShareWidget, email, svcType);
    setPendingExtraShareWidget(next);
    setExtraShareWidgetDirty(true);
    setExtraShareWidgetSaved(false);
  };
  const saveWidgetExtraShare = () => {
    setExtraShareWidget(pendingExtraShareWidget);
    saveExtraShareToStorage(pendingExtraShareWidget);
    setExtraShareWidgetDirty(false);
    setExtraShareWidgetSaved(true);
    setTimeout(() => setExtraShareWidgetSaved(false), 2000);
  };
  const isWidgetExtraOn = (email: string, svcType: string) => getExtraShareOn(extraShareWidget, email, svcType);
  const isPendingWidgetOn = (email: string, svcType: string) => getExtraShareOn(pendingExtraShareWidget, email, svcType);

  // 추가공유 메모 (Widget용)
  const [extraShareMemos, setExtraShareMemos] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('extraShareMemos') || '{}'); } catch { return {}; }
  });
  const getExtraShareMemoKey = (email: string, svcType: string) => `${email}__${svcType}`;
  const updateExtraShareMemo = (email: string, svcType: string, value: string) => {
    const key = getExtraShareMemoKey(email, svcType);
    const next = { ...extraShareMemos, [key]: value };
    setExtraShareMemos(next);
    localStorage.setItem('extraShareMemos', JSON.stringify(next));
  };

  const profits = calcServiceProfits(data, "snapshot", now, getSubStartDay, isWidgetExtraOn);
  const calEvents = buildCalendarEvents(profits, "snapshot", now, calYear, calMonth, getSubStartDay, personalSub, isWidgetExtraOn);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const monthLabel = `${calYear}년 ${calMonth + 1}월`;
  const prevMonth = () => { setSelectedDay(null); if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1); };
  const nextMonth = () => { setSelectedDay(null); if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1); };

  const monthTotalIncome = calEvents.filter(e => e.type !== 'expense').reduce((s, e) => s + e.amount, 0);
  const monthTotalExpense = calEvents.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const monthNet = monthTotalIncome - monthTotalExpense;
  const dayEvents = selectedDay ? calEvents.filter(e => e.day === selectedDay) : [];
  const dayIncome = dayEvents.filter(e => e.type !== 'expense').reduce((s, e) => s + e.amount, 0);
  const dayExpense = dayEvents.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

  return (
    <div style={{ padding: '12px 0 0' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Calendar size={16} color="#A78BFA" /> 월간 결제/수입 캘린더
      </div>

      {/* 달력 */}
      <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #F3F0FF' }}>
          <button onClick={prevMonth} style={{ background: '#F3F0FF', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
            <ChevronLeft size={16} color="#7C3AED" />
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{monthLabel}</span>
          <button onClick={nextMonth} style={{ background: '#F3F0FF', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
            <ChevronRight size={16} color="#7C3AED" />
          </button>
        </div>
        {calEvents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid #F3F0FF' }}>
            <div style={{ flex: 1, background: '#ECFDF5', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6B7280' }}>수입</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>+{monthTotalIncome.toLocaleString()}</div>
            </div>
            <div style={{ flex: 1, background: '#FFF0F0', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6B7280' }}>지출</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>-{monthTotalExpense.toLocaleString()}</div>
            </div>
            <div style={{ flex: 1, background: monthNet >= 0 ? '#F0FDF4' : '#FFF0F0', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#6B7280' }}>순수익</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: monthNet >= 0 ? '#059669' : '#EF4444' }}>{monthNet >= 0 ? '+' : ''}{monthNet.toLocaleString()}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '8px 8px 4px' }}>
          {['일', '월', '화', '수', '목', '금', '토'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: d === '일' ? '#EF4444' : d === '토' ? '#2563EB' : '#9CA3AF', padding: '2px 0' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', padding: '0 8px 10px', gap: 2 }}>
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const de = calEvents.filter(e => e.day === day);
            const isSel = selectedDay === day;
            const isToday = day === now.getDate() && calMonth === now.getMonth() && calYear === now.getFullYear();
            return (
              <button key={day} onClick={() => setSelectedDay(isSel ? null : day)} style={{
                background: isSel ? '#A78BFA' : isToday ? '#F3F0FF' : 'none',
                border: 'none', borderRadius: 10, padding: '6px 2px',
                cursor: de.length > 0 ? 'pointer' : 'default',
                fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minHeight: 42,
              }}>
                <span style={{ fontSize: 12, fontWeight: isToday || isSel ? 700 : 400, color: isSel ? '#fff' : isToday ? '#7C3AED' : '#1E1B4B' }}>{day}</span>
                {de.length > 0 && (() => {
                  const dInc = de.filter(e => e.type !== 'expense').reduce((s,e) => s+e.amount, 0);
                  const dExp = de.filter(e => e.type === 'expense').reduce((s,e) => s+e.amount, 0);
                  return (
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                      {dInc > 0 && <div style={{ fontSize:7, fontWeight:700, color: isSel?'#6EE7B7':'#059669', lineHeight:1 }}>+{(dInc/1000).toFixed(dInc%1000===0?0:1)}k</div>}
                      {dExp > 0 && <div style={{ fontSize:7, fontWeight:700, color: isSel?'#FCA5A5':'#EF4444', lineHeight:1 }}>-{(dExp/1000).toFixed(dExp%1000===0?0:1)}k</div>}
                    </div>
                  );
                })()}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '0 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} /> 지출
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669' }} /> 수입
          </div>
        </div>
      </div>

      {/* 선택된 날짜 상세 */}
      {selectedDay && dayEvents.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', marginBottom: 14, boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>{calMonth + 1}월 {selectedDay}일</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {dayIncome > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', background: '#ECFDF5', borderRadius: 6, padding: '2px 8px' }}>+{dayIncome.toLocaleString()}</span>}
              {dayExpense > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: '#EF4444', background: '#FFF0F0', borderRadius: 6, padding: '2px 8px' }}>-{dayExpense.toLocaleString()}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dayEvents.map((evt, i) => {
              const isExp = evt.type === 'expense';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8F6FF', borderRadius: 10, padding: '8px 12px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: isExp ? '#EF4444' : '#059669' }} />
                  <div style={{ flex: 1, fontSize: 12, color: '#1E1B4B' }}>{evt.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isExp ? '#EF4444' : '#059669' }}>
                    {isExp ? '-' : '+'}{evt.amount.toLocaleString()}원
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {selectedDay && dayEvents.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 16, padding: '20px 16px', marginBottom: 14, textAlign: 'center', color: '#9CA3AF', fontSize: 13, boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE' }}>
          {calMonth + 1}월 {selectedDay}일에는 예정된 결제/수입이 없어요
        </div>
      )}

      {/* 구독 설정 */}
      {profits.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #EDE9FE', marginBottom: 14 }}>
          <button
            onClick={() => setShowSubSettings(v => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Settings size={16} color="#A78BFA" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B', flex: 1, textAlign: 'left' }}>구독 설정</span>
            {aliasLoading && <Loader2 size={13} color="#9CA3AF" style={{ animation: 'spin 1s linear infinite' }} />}
            {!aliasLoading && Object.keys(aliasMap).length > 0 && (
              <span style={{ fontSize: 11, background: '#ECFDF5', color: '#059669', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>SL연동</span>
            )}
            {(personalSub.netflix || personalSub.tving || personalSub.disney) && (
              <span style={{ fontSize: 11, background: '#EDE9FE', color: '#7C3AED', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                개인 -{[['netflix',personalSub.netflix],['tving',personalSub.tving],['disney',personalSub.disney]].filter(([,v])=>v).reduce((s,[k])=>s+PERSONAL_SUB_COSTS[k as string],0).toLocaleString()}원
              </span>
            )}
            {showSubSettings ? <ChevronDown size={15} color="#A78BFA" /> : <ChevronRight size={15} color="#A78BFA" />}
          </button>

          {showSubSettings && (
            <div style={{ borderTop: '1px solid #F3F0FF', padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 추가공유 저장 버튼 */}
              {extraShareWidgetDirty && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFFBEB", borderRadius: 10, padding: "8px 12px", border: "1px solid #FDE68A" }}>
                  <span style={{ fontSize: 12, color: "#D97706", flex: 1, fontWeight: 600 }}>추가공유 설정이 변경됐어요</span>
                  <button onClick={saveWidgetExtraShare} style={{ background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}>
                    <Check size={13} strokeWidth={3} /> 저장
                  </button>
                </div>
              )}
              {extraShareWidgetSaved && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#ECFDF5", borderRadius: 10, padding: "8px 12px" }}>
                  <Check size={13} color="#059669" strokeWidth={3} />
                  <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>저장 완료! 수익 계산에 반영됐어요</span>
                </div>
              )}
              <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.6 }}>
                각 파티 이메일의 구독 시작일(캘린더 지출 기준일)을 설정해요.<br />
                <span style={{ color: '#059669', fontWeight: 600 }}>● SL</span> = SimpleLogin 계정 생성일 자동 적용 &nbsp;
                <span style={{ color: '#7C3AED', fontWeight: 600 }}>● 직접</span> = 커스텀 설정
              </div>

              {profits.map(svc => {
                  const sortedAccts = [...svc.accounts].sort((a, b) => {
                    const getDay = (ac: any) => {
                      const aDay = subStarts[ac.email] || aliasMap[ac.email];
                      if (aDay) return aDay;
                      let earliest: Date | null = null;
                      for (const m of ac.members) {
                        const sd = parseDate(m.startDateTime);
                        if (sd && (!earliest || sd < earliest)) earliest = sd;
                      }
                      return earliest ? earliest.getDate() : (ac.renewalDay ?? 1);
                    };
                    return getDay(a) - getDay(b);
                  });
                  const { color: svcClrHeader } = svcColor(svc.serviceType);
                  const logoHeader = svcLogo(svc.serviceType);
                  return (
                    <div key={svc.serviceType} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* 서비스 카테고리 헤더 */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px' }}>
                        {logoHeader && <img src={logoHeader} alt="" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'contain' }} />}
                        <span style={{ fontSize: 12, fontWeight: 700, color: svcClrHeader }}>{svc.serviceType}</span>
                        <span style={{ fontSize: 10, color: '#C4B5FD' }}>{svc.accounts.length}개 계정</span>
                      </div>
                      {sortedAccts.map(acct => {
                  const aliasDay = aliasMap[acct.email];
                  const customDay = subStarts[acct.email];
                  const rawFallback = (() => {
                    let earliest: Date | null = null;
                    for (const m of acct.members) {
                      const sd = parseDate(m.startDateTime);
                      if (sd && (!earliest || sd < earliest)) earliest = sd;
                    }
                    return earliest ? earliest.getDate() : (acct.renewalDay ?? null);
                  })();
                  const effectiveDay = customDay || aliasDay || rawFallback || 1;
                  const source = customDay ? '직접' : aliasDay ? 'SL' : '자동';
                  const srcColor = customDay ? '#7C3AED' : aliasDay ? '#059669' : '#9CA3AF';
                  const isEditing = editingSubStart === acct.email;

                  let latestEnd: Date | null = null;
                  let earliestStart: Date | null = null;
                  for (const m of acct.members) {
                    const ed = parseDate(m.endDateTime);
                    const sd = parseDate(m.startDateTime);
                    if (ed && (!latestEnd || ed > latestEnd)) latestEnd = ed;
                    if (sd && (!earliestStart || sd < earliestStart)) earliestStart = sd;
                  }
                  const unitCost = getSubscriptionCost(svc.serviceType);
                  const unitExtraCost = EXTRA_COST[svc.serviceType] || 0;
                  const perPayment = unitCost + unitExtraCost;
                  const payCount = (earliestStart && latestEnd) ? countPayments(earliestStart, latestEnd, effectiveDay) : 0;
                  const totalSubCost = perPayment * payCount;
                  const payDates: Date[] = [];
                  if (earliestStart && latestEnd && payCount > 0) {
                    let y = earliestStart.getFullYear(), mo = earliestStart.getMonth();
                    const endY = latestEnd.getFullYear(), endMo = latestEnd.getMonth();
                    while (y < endY || (y === endY && mo <= endMo)) {
                      const daysInMo = new Date(y, mo + 1, 0).getDate();
                      const pd = new Date(y, mo, Math.min(effectiveDay, daysInMo));
                      if (pd >= earliestStart && pd < latestEnd) payDates.push(pd);
                      mo++; if (mo > 11) { mo = 0; y++; }
                    }
                  }
                  const periodStr = earliestStart && latestEnd
                    ? `${earliestStart.getMonth()+1}/${earliestStart.getDate()}~${latestEnd.getMonth()+1}/${latestEnd.getDate()}`
                    : null;
                  const logo = svcLogo(svc.serviceType);

                  return (
                    <div key={acct.email} style={{ background: '#F8F6FF', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {logo && <img src={logo} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'contain' }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {emailAlias(acct.email)}
                            {emailAlias(acct.email) !== acct.email && <span style={{ fontSize: 9, color: '#C4B5FD', marginLeft: 4, fontWeight: 400 }}>{acct.email.length > 20 ? acct.email.slice(0,20)+'…' : acct.email}</span>}
                          </div>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: srcColor, fontWeight: 600 }}>● {source}</span>
                            {aliasDay && !customDay && <span>SL 가입일: {aliasDay}일</span>}
                            {customDay && <span>커스텀: {customDay}일</span>}
                            {periodStr && <span style={{ color: '#C4B5FD' }}>· {periodStr}</span>}
                          </div>
                        </div>
                        {payCount > 0 && (
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#EF4444' }}>-{totalSubCost.toLocaleString()}원</div>
                            <div style={{ fontSize: 10, color: '#9CA3AF' }}>{payCount}회 × {perPayment.toLocaleString()}원</div>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: '#9CA3AF', flex: 1 }}>매월 결제일</span>
                        {isEditing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="number" min={1} max={28} value={subStartInput}
                              onChange={e => setSubStartInput(e.target.value)} autoFocus
                              style={{ width: 50, padding: '4px 6px', borderRadius: 7, border: '1.5px solid #A78BFA', fontSize: 13, textAlign: 'center', fontFamily: 'inherit', color: '#1E1B4B' }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { const v = Math.max(1, Math.min(28, parseInt(subStartInput)||1)); updateSubStart(acct.email, v); setEditingSubStart(null); }
                                else if (e.key === 'Escape') setEditingSubStart(null);
                              }}
                            />
                            <span style={{ fontSize: 11, color: '#9CA3AF' }}>일</span>
                            <button onClick={() => { const v = Math.max(1, Math.min(28, parseInt(subStartInput)||1)); updateSubStart(acct.email, v); setEditingSubStart(null); }} style={{ background: '#A78BFA', border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}>
                              <Check size={12} color="#fff" strokeWidth={3} />
                            </button>
                            <button onClick={() => setEditingSubStart(null)} style={{ background: '#F3F0FF', border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}>
                              <X size={12} color="#9CA3AF" />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#A78BFA' }}>{effectiveDay}일</span>
                            <button onClick={() => { setEditingSubStart(acct.email); setSubStartInput(String(effectiveDay)); }} style={{ background: '#EDE9FE', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                              <Pencil size={11} color="#7C3AED" />
                            </button>
                            {customDay && (
                              <button onClick={() => { const next = { ...subStarts }; delete next[acct.email]; setSubStarts(next); saveSubStarts(next); }} style={{ background: '#FFF0F0', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                <X size={11} color="#EF4444" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {payDates.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {payDates.map((pd, i) => {
                            const isPast = pd < now;
                            return (
                              <span key={i} style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: isPast ? '#ECFDF5' : '#FFF0F0', color: isPast ? '#059669' : '#EF4444', border: `1px solid ${isPast ? '#A7F3D0' : '#FECACA'}` }}>
                                {pd.getMonth()+1}/{pd.getDate()}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {/* 파티별 추가공유 ON/OFF */}
                      {(EXTRA_INCOME[svc.serviceType] || EXTRA_COST[svc.serviceType]) ? (
                        <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: isPendingWidgetOn(acct.email, svc.serviceType) ? '#F0FDF4' : '#F9FAFB', borderRadius: 8, padding: '7px 10px' }}>
                          <span style={{ fontSize: 11, color: '#6B7280', flex: 1 }}>
                            {svc.serviceType} 추가공유
                            {EXTRA_INCOME[svc.serviceType] ? <span style={{ color: '#059669', fontWeight: 600 }}> +{EXTRA_INCOME[svc.serviceType].toLocaleString()}</span> : ''}
                            {EXTRA_COST[svc.serviceType] ? <span style={{ color: '#EF4444' }}> / -{EXTRA_COST[svc.serviceType].toLocaleString()}</span> : ''}
                          </span>
                          <button
                            onClick={() => togglePendingWidget(acct.email, svc.serviceType)}
                            style={{
                              width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                              background: isPendingWidgetOn(acct.email, svc.serviceType) ? '#059669' : '#D1D5DB',
                              position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                            }}
                          >
                            <div style={{
                              position: 'absolute', top: 3, left: isPendingWidgetOn(acct.email, svc.serviceType) ? 20 : 3,
                              width: 16, height: 16, borderRadius: '50%', background: '#fff',
                              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                            }} />
                          </button>
                          <span style={{ fontSize: 10, color: isPendingWidgetOn(acct.email, svc.serviceType) ? '#059669' : '#9CA3AF', fontWeight: 600, minWidth: 20 }}>
                            {isPendingWidgetOn(acct.email, svc.serviceType) ? 'ON' : 'OFF'}
                          </span>
                        </div>
                        {/* 추가공유 ON일 때 계정 링크 메모 */}
                        {isPendingWidgetOn(acct.email, svc.serviceType) && (
                          <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>📋 계정 추가공유 링크</span>
                            <input
                              type="text"
                              value={extraShareMemos[getExtraShareMemoKey(acct.email, svc.serviceType)] || ''}
                              onChange={e => updateExtraShareMemo(acct.email, svc.serviceType, e.target.value)}
                              placeholder="추가공유 초대 링크를 붙여넣으세요"
                              style={{
                                width: '100%', fontSize: 11, padding: '5px 8px', borderRadius: 6,
                                border: '1px solid #A7F3D0', outline: 'none', background: '#fff',
                                color: '#1E1B4B', boxSizing: 'border-box',
                              }}
                            />
                            {extraShareMemos[getExtraShareMemoKey(acct.email, svc.serviceType)] && (
                              <a
                                href={extraShareMemos[getExtraShareMemoKey(acct.email, svc.serviceType)]}
                                target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 10, color: '#059669', textDecoration: 'underline', wordBreak: 'break-all' }}
                              >
                                링크 열기 →
                              </a>
                            )}
                          </div>
                        )}
                        </>
                      ) : null}
                    </div>
                  );
                })}
                      </div>
                    );
                  })}

              <div style={{ height: 1, background: '#EDE9FE', margin: '2px 0' }} />

              <div style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED', marginBottom: 2 }}>
                개인 추가 공유 구독
                {(personalSub.netflix || personalSub.tving || personalSub.disney) && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}>
                    월 -{[['netflix',personalSub.netflix],['tving',personalSub.tving],['disney',personalSub.disney]].filter(([,v])=>v).reduce((s,[k])=>s+PERSONAL_SUB_COSTS[k as string],0).toLocaleString()}원
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: -6, marginBottom: 2 }}>내가 직접 결제하는 OTT 추가 공유 비용 (캘린더 지출에 반영)</div>
              {([
                { key: 'netflix' as const, dayKey: 'netflixDay' as const, label: '넷플릭스 추가 공유', cost: PERSONAL_SUB_COSTS.netflix, color: '#E50914' },
                { key: 'tving'   as const, dayKey: 'tvingDay'   as const, label: '티빙 추가 공유',   cost: PERSONAL_SUB_COSTS.tving,   color: '#FF153C' },
                { key: 'disney'  as const, dayKey: 'disneyDay'  as const, label: '디즈니+ 추가 공유', cost: PERSONAL_SUB_COSTS.disney,  color: '#1A3E8C' },
              ] as const).map(item => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8F6FF', borderRadius: 10, padding: '9px 12px' }}>
                  <button onClick={() => updatePersonalSub({ [item.key]: !personalSub[item.key] } as any)}
                    style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${personalSub[item.key] ? item.color : '#D1D5DB'}`, background: personalSub[item.key] ? item.color : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {personalSub[item.key] && <Check size={13} color="#fff" strokeWidth={3} />}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B' }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{item.cost.toLocaleString()}원/월</div>
                  </div>
                  {personalSub[item.key] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>결제일</span>
                      <input type="number" min={1} max={28} value={personalSub[item.dayKey]}
                        onChange={e => { const v = Math.max(1, Math.min(28, parseInt(e.target.value)||1)); updatePersonalSub({ [item.dayKey]: v } as any); }}
                        style={{ width: 44, padding: '4px 6px', borderRadius: 6, border: '1.5px solid #EDE9FE', fontSize: 12, textAlign: 'center', fontFamily: 'inherit', color: '#1E1B4B', background: '#fff' }}
                      />
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>일</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
