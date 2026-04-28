import { useEffect, useState } from "react";
import ManagePage from "./manage";
import { MonthlyCalendarWidget } from "./profit";
import { useLocation } from "wouter";
import { CATEGORIES } from "../lib/constants";
import { buildPartyMaintenanceTargets, buildServiceStats, type PartyMaintenanceTarget } from "../lib/dashboard-stats";
import { buildChatAlerts, buildUnreadChatAlerts, type ChatAlertItem, type ChatAlertRoom } from "../lib/chat-alerts";
import { buildPartyMaintenanceChecklistItems, generateMaintenancePassword, mergePartyMaintenanceChecklistState, splitPartyMaintenanceChecklistItems, type PartyMaintenanceChecklistItem, type PartyMaintenanceChecklistState, type PartyMaintenanceChecklistStore } from "../../lib/party-maintenance-checklist";
import { RefreshCw, ChevronRight, User, Loader2, TrendingUp, TrendingDown, Wallet, CheckCircle2, RotateCcw, Settings, Zap, ShieldAlert, Bell, MessageCircle } from "lucide-react";
import { Card, StatCard } from "../components/ui/card";
import { StatusBadge } from "../components/ui/status-badge";

// ─── 타입 ─────────────────────────────────────────────────────
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
  onSaleByKeepAcct: Record<string, any[]>;
  summary: {
    totalUsingMembers: number; totalActiveMembers: number;
    totalIncome: number; totalRealized: number; totalAccounts: number;
  };
  updatedAt: string;
}

// ─── 수동 파티원 타입 ────────────────────────────────────────────
interface ManualMember {
  id: string; serviceType: string; accountEmail: string;
  memberName: string; startDate: string; endDate: string;
  price: number; source: string; memo: string; createdAt: string;
  status: 'active' | 'expired' | 'cancelled';
}

// ─── 피드백 타입 ────────────────────────────────────────────────
interface FeedbackItem {
  id: string; type: 'extra_payment' | 'gap' | 'underfill_risk' | 'party_needed';
  serviceType: string; accountEmail: string;
  title: string; detail: string; generatedAt: string;
  done: boolean; doneAt: string | null;
}

interface SellerStatus {
  ok: boolean;
  generatedAt: string;
  session: { ok: boolean; status: string; lastCheck: string | null };
  pollDaemon: { ok: boolean; lastSuccess: string | null; lastError: string | null; consecutiveFailures: number };
  undercutter: { enabled: boolean; lastRun: string | null; intervalMinutes: number };
  autoReply: { enabled: boolean; lastLogAt: string | null };
  data: { knownDeals: number; manualMembers: number };
  warnings: string[];
}

interface SafeModeState {
  enabled: boolean;
  reason: string;
  updatedAt: string;
  updatedBy: string;
}

// ─── 쿠키 ──────────────────────────────────────────────────────
const AUTO_COOKIE_ID = '__session_keeper__';
const AUTO_COOKIE = { id: AUTO_COOKIE_ID, label: '자동', AWSALB: '', AWSALBCORS: '', JSESSIONID: '__auto__' };
const STORAGE_KEY = 'graytag_cookies_v2';
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => {
  try { return [AUTO_COOKIE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')]; }
  catch { return [AUTO_COOKIE]; }
};

// ─── 풀파티 기준 월 순수익 (수수료·파티유지비용 모두 차감 후) ──────
// 추가없음 / 추가있음 두 가지 상수
const FULL_PARTY_NET_BASE: Record<string, number> = {
  '넷플릭스':    15000,
  '디즈니플러스':  5000,
  '티빙':        26000,
  '웨이브':          0,   // 추가없음 미정 → 0 (알게 되면 업데이트)
};
const FULL_PARTY_NET_EXTRA: Record<string, number> = {
  '넷플릭스':    23000,
  '디즈니플러스':  8000,
  '티빙':        36000,
  '웨이브':       1000,
};

const PARTY_MAX: Record<string, number> = {
  '디즈니플러스': 6, '왓챠플레이': 4, '티빙': 4, '웨이브': 4, '넷플릭스': 5,
};
const getPartyMax = (svc: string) => PARTY_MAX[svc] || 6;
const EXCLUDED_SERVICES = ['왓챠', '애플원', '유튜브', '왓챠플레이'];

// 계정 파티 기간 개월수 계산 (그레이태그 데이터 기반)
function calcAccountMonths(acct: any): number {
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const m of acct.members || []) {
    const sd = m.startDateTime ? new Date(m.startDateTime.replace(/\s/g,'').replace(/\./g,'-').replace(/-$/,'')) : null;
    const ed = m.endDateTime   ? new Date(m.endDateTime.replace(/\s/g,'').replace(/\./g,'-').replace(/-$/,''))   : null;
    if (sd && !isNaN(sd.getTime()) && (!earliest || sd < earliest)) earliest = sd;
    if (ed && !isNaN(ed.getTime()) && (!latest   || ed > latest))   latest   = ed;
  }
  if (!earliest || !latest) return 1;
  const months = (latest.getFullYear() - earliest.getFullYear()) * 12
               + (latest.getMonth() - earliest.getMonth()) + 1;
  return Math.max(1, months);
}

// 수익 종합 계산 (풀파티 기준)
interface ProfitSvcDetail { serviceType: string; accountCount: number; netProfit: number; }
interface ProfitSummary {
  totalRevenue: number;
  maintenanceCost: number;
  manualIncome: number;
  netProfit: number;
  svcDetails: ProfitSvcDetail[];
}
function calcProfitSummary(data: ManageData | null, extraShareOn: Record<string, boolean>, manuals: ManualMember[]): ProfitSummary {
  if (!data) return { totalRevenue: 0, maintenanceCost: 0, manualIncome: 0, netProfit: 0, svcDetails: [] };

  let totalNet = 0;
  const svcMap: Record<string, { accounts: number; net: number }> = {};

  for (const svc of data.services) {
    if (EXCLUDED_SERVICES.includes(svc.serviceType)) continue;
    const activeAccounts = svc.accounts.filter((a: any) => a.usingCount > 0 || a.activeCount > 0);

    for (const acct of activeAccounts) {
      const key = `${acct.email}__${svc.serviceType}`;
      const isOn = key in extraShareOn ? extraShareOn[key] : true;
      const monthlyNet = isOn
        ? (FULL_PARTY_NET_EXTRA[svc.serviceType] ?? FULL_PARTY_NET_BASE[svc.serviceType] ?? 0)
        : (FULL_PARTY_NET_BASE[svc.serviceType] ?? 0);
      const months = calcAccountMonths(acct);
      const acctNet = monthlyNet * months;
      totalNet += acctNet;
      if (!svcMap[svc.serviceType]) svcMap[svc.serviceType] = { accounts: 0, net: 0 };
      svcMap[svc.serviceType].accounts++;
      svcMap[svc.serviceType].net += acctNet;
    }
  }

  // 수동 파티원 수입
  const today = new Date().toISOString().split('T')[0];
  const manualIncome = manuals
    .filter(m => m.status !== 'cancelled' && m.startDate <= today && m.endDate >= today)
    .reduce((s, m) => s + m.price, 0);

  const netProfit = totalNet + manualIncome;
  const svcDetails: ProfitSvcDetail[] = Object.entries(svcMap)
    .map(([serviceType, v]) => ({ serviceType, accountCount: v.accounts, netProfit: v.net }))
    .sort((a, b) => b.netProfit - a.netProfit);

  return {
    totalRevenue: netProfit,
    maintenanceCost: 0,
    manualIncome,
    netProfit,
    svcDetails,
  };
}

// 수동 파티원 중 오늘 기준 active(이용 중) 수 계산
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

// 수동 파티원 이번 달 수익 합산 (price는 총 금액, 이번 달 비율로 안분 or 그냥 합산)
// 단순하게: 현재 active인 수동 파티원의 price 합산 (월 단위로 보정 없이 등록 금액 그대로)
function getActiveManualIncome(manuals: ManualMember[], serviceType: string, accountEmail: string): number {
  const today = new Date().toISOString().split('T')[0];
  return manuals
    .filter(m =>
      m.serviceType === serviceType &&
      m.accountEmail === accountEmail &&
      m.status !== 'cancelled' &&
      m.startDate <= today &&
      m.endDate >= today
    )
    .reduce((s, m) => s + m.price, 0);
}

// ─── 서비스별 통계는 계정 관리 화면과 같은 기준으로 ../lib/dashboard-stats 에서 계산 ─────────

const findCategory = (svcType: string) =>
  CATEGORIES.find(c => c.label === svcType || svcType.includes(c.label.slice(0, 2)));

// ─── 일별 파티 유입 그래프 ──────────────────────────────────────
interface InflowEntry { name: string | null; serviceType: string; accountEmail: string; startDate: string; endDate: string | null; price: string; }

function parseGrayDate(s: string | null): string | null {
  if (!s) return null;
  // "26. 03. 14" 또는 "2026. 03. 14" 형태
  const parts = s.trim().split('.').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    let y = parseInt(parts[0]); if (y < 100) y += 2000;
    const m = parseInt(parts[1]).toString().padStart(2, '0');
    const d = parseInt(parts[2]).toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // ISO 형태도 처리
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function buildDailyInflow(data: ManageData, days: number = 30): { date: string; label: string; count: number; members: InflowEntry[] }[] {
  const countMap: Record<string, number> = {};
  const memberMap: Record<string, InflowEntry[]> = {};

  for (const svc of data.services) {
    for (const acct of svc.accounts) {
      for (const member of acct.members) {
        const iso = parseGrayDate(member.startDateTime);
        if (iso) {
          countMap[iso] = (countMap[iso] || 0) + 1;
          if (!memberMap[iso]) memberMap[iso] = [];
          memberMap[iso].push({
            name: member.name,
            serviceType: svc.serviceType,
            accountEmail: acct.email,
            startDate: iso,
            endDate: parseGrayDate(member.endDateTime),
            price: member.price,
          });
        }
      }
    }
  }

  const result: { date: string; label: string; count: number; members: InflowEntry[] }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    result.push({ date: iso, label, count: countMap[iso] || 0, members: memberMap[iso] || [] });
  }
  return result;
}

const SVC_COLORS: Record<string, string> = {
  '넷플릭스': '#E50914', '디즈니플러스': '#0063E5', '티빙': '#FF153C', '웨이브': '#006EFF', '왓챠': '#FF0558',
};

function DailyInflowChart({ data }: { data: ManageData }) {
  const [range, setRange] = useState<14 | 30>(14);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const rows = buildDailyInflow(data, range);
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  const totalInflow = rows.reduce((s, r) => s + r.count, 0);
  const todayCount = rows[rows.length - 1]?.count ?? 0;

  // 7일 이동평균
  const avg7 = rows.map((_, i) => {
    const slice = rows.slice(Math.max(0, i - 6), i + 1);
    return slice.reduce((s, r) => s + r.count, 0) / slice.length;
  });

  const BAR_H = 100; // 최대 막대 높이 px
  const BAR_W = range === 14 ? 18 : 9;
  const GAP = range === 14 ? 4 : 2;

  return (
    <div style={{ marginTop: 20, marginBottom: 4 }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B' }}>📈 일별 파티 유입</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {([14, 30] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{ padding: '4px 10px', borderRadius: 8, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: range === r ? '#1E1B4B' : '#F3F4F6', color: range === r ? '#fff' : '#9CA3AF' }}>
              {r}일
            </button>
          ))}
        </div>
      </div>

      {/* 요약 수치 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, background: '#F5F3FF', borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: '#7C3AED', fontWeight: 600, marginBottom: 2 }}>오늘 유입</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1E1B4B', lineHeight: 1 }}>{todayCount}<span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 400 }}>명</span></div>
        </div>
        <div style={{ flex: 1, background: '#F0FDF4', borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: '#059669', fontWeight: 600, marginBottom: 2 }}>{range}일 합계</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1E1B4B', lineHeight: 1 }}>{totalInflow}<span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 400 }}>명</span></div>
        </div>
        <div style={{ flex: 1, background: '#FFF7ED', borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: '#D97706', fontWeight: 600, marginBottom: 2 }}>일 평균</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1E1B4B', lineHeight: 1 }}>{(totalInflow / range).toFixed(1)}<span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 400 }}>명</span></div>
        </div>
      </div>

      {/* 막대 그래프 */}
      <div style={{ background: '#fff', borderRadius: 16, padding: '16px 12px 8px', border: '1.5px solid #EDE9FE', overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: `${GAP}px`, minWidth: rows.length * (BAR_W + GAP), height: BAR_H + 32 }}>
          {rows.map((row, i) => {
            const barH = row.count > 0 ? Math.max(4, Math.round((row.count / maxCount) * BAR_H)) : 0;
            const isToday = i === rows.length - 1;
            const isWeekend = new Date(row.date).getDay() === 0 || new Date(row.date).getDay() === 6;
            const barColor = isToday ? '#7C3AED' : row.count >= maxCount ? '#059669' : row.count > 0 ? '#A78BFA' : '#E5E7EB';

            return (
              <div key={row.date} onClick={() => row.count > 0 && setSelectedDate(row.date === selectedDate ? null : row.date)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: BAR_W, flexShrink: 0, cursor: row.count > 0 ? 'pointer' : 'default' }}>
                {/* 숫자 */}
                {row.count > 0 && (
                  <div style={{ fontSize: 9, fontWeight: 700, color: isToday ? '#7C3AED' : '#6B7280', marginBottom: 2, lineHeight: 1 }}>
                    {row.count}
                  </div>
                )}
                {/* 빈 공간 (숫자 없는 경우 정렬용) */}
                {row.count === 0 && <div style={{ height: 13 }} />}
                {/* 막대 */}
                <div style={{ width: '100%', height: barH || 3, background: barColor, borderRadius: '3px 3px 0 0', transition: 'height 0.3s ease', minHeight: 3 }} />
                {/* x축 구분선 */}
                <div style={{ width: '100%', height: 1, background: '#E5E7EB' }} />
                {/* 날짜 라벨 */}
                {(range === 14 || i % 3 === 0) && (
                  <div style={{ fontSize: 8, color: isToday ? '#7C3AED' : isWeekend ? '#EF4444' : '#9CA3AF', marginTop: 3, fontWeight: isToday ? 700 : 400, whiteSpace: 'nowrap' }}>
                    {row.label}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 범례 */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, paddingTop: 8, borderTop: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
            <div style={{ width: 8, height: 8, background: '#7C3AED', borderRadius: 2 }} />오늘
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
            <div style={{ width: 8, height: 8, background: '#059669', borderRadius: 2 }} />최다 유입
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9CA3AF' }}>
            <div style={{ width: 8, height: 8, background: '#A78BFA', borderRadius: 2 }} />일반
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 10, color: '#9CA3AF' }}>막대 클릭 → 상세</div>
        </div>
      </div>

      {/* 날짜별 유입 상세 */}
      {(() => {
        // 클릭된 날짜 없으면 유입 있는 가장 최근 날짜 자동 선택
        const displayDate = selectedDate || [...rows].reverse().find(r => r.count > 0)?.date || null;
        const displayRow = rows.find(r => r.date === displayDate);
        if (!displayRow || displayRow.members.length === 0) return null;
        const isToday = displayDate === new Date().toISOString().split('T')[0];
        return (
          <div style={{ marginTop: 12, background: '#fff', borderRadius: 16, border: '1.5px solid #EDE9FE', padding: '14px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', marginBottom: 10 }}>
              {isToday ? '오늘' : displayRow.label} 유입 {displayRow.count}명
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {displayRow.members.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#F5F3FF', borderRadius: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: SVC_COLORS[m.serviceType] || '#9CA3AF', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1E1B4B' }}>{m.name || '(이름없음)'}</span>
                    <span style={{ fontSize: 10, color: '#7C3AED', marginLeft: 6, fontWeight: 600 }}>{m.serviceType}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#6B7280', whiteSpace: 'nowrap' }}>
                    {m.startDate}{m.endDate ? ` ~ ${m.endDate}` : ''}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', whiteSpace: 'nowrap' }}>{m.price}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── 피드백 색상 ────────────────────────────────────────────────
const FEEDBACK_STYLE: Record<string, { bg: string; border: string; accent: string; label: string }> = {
  extra_payment: { bg: '#FFF1F2', border: '#FECDD3', accent: '#EF4444', label: '결제 특이' },
  gap:           { bg: '#FFFBEB', border: '#FDE68A', accent: '#D97706', label: '파티 공백' },
  underfill_risk:{ bg: '#FFF7ED', border: '#FED7AA', accent: '#F59E0B', label: '미채움 위험' },
  party_needed:  { bg: '#EFF6FF', border: '#BFDBFE', accent: '#2563EB', label: '파티 필요' },
};

// ─── PartyFeedbackPanel ──────────────────────────────────────────
function PartyFeedbackPanel({ manageData }: { manageData: ManageData }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [tab, setTab] = useState<'todo' | 'done'>('todo');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [warningDays, setWarningDays] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/feedback-settings');
      const json = await res.json() as any;
      setWarningDays(json.underfillWarningDays ?? 0);
    } catch {}
  };

  const saveSettings = async (days: number) => {
    setSavingSettings(true);
    try {
      await fetch('/api/feedback-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ underfillWarningDays: days }),
      });
      setWarningDays(days);
      await generate();
    } catch {} finally { setSavingSettings(false); }
  };

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/party-feedback/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manageData }),
      });
      const json = await res.json() as any;
      setItems(json.items || []);
    } catch {} finally { setLoading(false); }
  };

  const toggle = async (id: string) => {
    try {
      const res = await fetch(`/api/party-feedback/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
      const json = await res.json() as any;
      if (json.ok) setItems(prev => prev.map(i => i.id === id ? json.item : i));
    } catch {}
  };

  useEffect(() => { fetchSettings(); generate(); }, []);

  const todoItems = items.filter(i => !i.done);
  const doneItems = items.filter(i => i.done);
  const shown = tab === 'todo' ? todoItems : doneItems;

  return (
    <div style={{ marginTop: 20, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={16} color="#7C3AED" strokeWidth={2.5} />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B' }}>{"파티 피드백"}</span>
          {todoItems.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, background: '#EF4444', color: '#fff', borderRadius: 20, padding: '1px 7px' }}>{todoItems.length}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowSettings(v => !v)}
            style={{ background: showSettings ? '#EDE9FE' : '#F3F4F6', border: 'none', borderRadius: 8, padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#7C3AED', fontWeight: 600, fontFamily: 'inherit' }}>
            <Settings size={12} />{"설정"}
          </button>
          <button onClick={generate} disabled={loading}
            style={{ background: '#EDE9FE', border: 'none', borderRadius: 8, padding: '5px 8px', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#7C3AED', fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>
            {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={11} />}
            {"새로고침"}
          </button>
        </div>
      </div>

      {showSettings && (
        <div style={{ background: '#F8F6FF', border: '1.5px solid #EDE9FE', borderRadius: 14, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>{"미채움 결제 위험 알림 설정"}</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 10 }}>{"결제일 기준 며칠 전부터 알림 (0 = 항상 감지)"}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={0} max={30} value={warningDays} onChange={e => setWarningDays(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#7C3AED' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#7C3AED', minWidth: 60 }}>{warningDays === 0 ? '항상' : `${warningDays}일 전`}</span>
            <button onClick={() => saveSettings(warningDays)} disabled={savingSettings}
              style={{ background: '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {savingSettings ? '저장 중' : '저장'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {(['todo', 'done'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: tab === t ? '#1E1B4B' : '#F3F4F6', color: tab === t ? '#fff' : '#9CA3AF' }}>
            {t === 'todo' ? `TODO (${todoItems.length})` : `DONE (${doneItems.length})`}
          </button>
        ))}
      </div>

      {loading && items.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#C4B5FD', fontSize: 12 }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 6px' }} />{"분석 중..."}
        </div>
      )}
      {!loading && shown.length === 0 && (
        <div style={{ textAlign: 'center', padding: '28px 0', color: '#9CA3AF', fontSize: 13 }}>
          {tab === 'todo' ? <><CheckCircle2 size={28} color="#10B981" style={{ display: 'block', margin: '0 auto 8px' }} />{"이상 없음 ✅ 모든 파티가 정상이에요"}</> : '완료된 항목이 없어요'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {shown.map(item => {
          const st = FEEDBACK_STYLE[item.type] || FEEDBACK_STYLE.extra_payment;
          return (
            <div key={item.id} style={{ background: item.done ? '#F9FAFB' : st.bg, border: `1.5px solid ${item.done ? '#E5E7EB' : st.border}`, borderRadius: 14, padding: '12px 14px', opacity: item.done ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: item.done ? '#9CA3AF' : st.accent, background: item.done ? '#F3F4F6' : st.border, borderRadius: 6, padding: '2px 7px', marginBottom: 6, display: 'inline-block' }}>
                    {item.done ? '✓ ' : ''}{st.label}
                  </span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: item.done ? '#9CA3AF' : '#1E1B4B', marginBottom: 4, lineHeight: 1.3 }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: item.done ? '#9CA3AF' : '#6B7280', lineHeight: 1.5 }}>{item.detail}</div>
                </div>
                <button onClick={() => toggle(item.id)} style={{ flexShrink: 0, border: 'none', borderRadius: 10, padding: '7px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, background: item.done ? '#E5E7EB' : st.accent, color: item.done ? '#6B7280' : '#fff', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  {item.done ? <><RotateCcw size={11} />{"되돌리기"}</> : <><CheckCircle2 size={11} />{"완료"}</>}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function ChoiceButton({ label, active, onClick, tone = 'purple' }: { label: string; active: boolean; onClick: () => void; tone?: 'purple' | 'green' | 'red' }) {
  const activeBg = tone === 'green' ? '#DCFCE7' : tone === 'red' ? '#FEE2E2' : '#EDE9FE';
  const activeColor = tone === 'green' ? '#047857' : tone === 'red' ? '#DC2626' : '#7C3AED';
  return (
    <button onClick={onClick} style={{ border: 'none', borderRadius: 8, padding: '5px 9px', background: active ? activeBg : '#F3F4F6', color: active ? activeColor : '#9CA3AF', fontSize: 10, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>
      {label}
    </button>
  );
}

function ChecklistRow({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#F9FAFB', borderRadius: 9, padding: '6px 7px' }}>
      <span style={{ fontSize: 10, color: '#4B5563', fontWeight: 800 }}>{label}</span>
      <span style={{ display: 'flex', gap: 4 }}>
        <ChoiceButton label="Y" active={value === true} onClick={() => onChange(true)} tone="green" />
        <ChoiceButton label="N" active={value === false} onClick={() => onChange(false)} tone="red" />
      </span>
    </div>
  );
}

function PartyMaintenancePanel({ items, regeneratingPinKey, onUpdate, onRegeneratePin, onGoManage, onGoWrite }: { items: PartyMaintenanceChecklistItem<PartyMaintenanceTarget>[]; regeneratingPinKey: string | null; onUpdate: (key: string, patch: Partial<PartyMaintenanceChecklistState>) => void; onRegeneratePin: (item: PartyMaintenanceChecklistItem<PartyMaintenanceTarget>) => void; onGoManage: () => void; onGoWrite: () => void }) {
  const { active, completed } = splitPartyMaintenanceChecklistItems(items);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  if (items.length === 0) return null;
  const currentItems = tab === 'active' ? active : completed;
  const noCurrentUsers = active.filter((item) => item.target.reason === 'no-current-users').length;
  const expiringSoon = active.filter((item) => item.target.reason === 'expiring-soon').length;
  const shortDate = (value: string) => value ? value.replace(/-/g, '/').slice(2) : '날짜 없음';
  const tabButtonStyle = (activeTab: boolean, tone: 'warning' | 'success') => ({
    border: 'none', borderRadius: 999, padding: '7px 10px',
    background: activeTab ? (tone === 'success' ? '#DCFCE7' : '#FEF3C7') : '#F3F4F6',
    color: activeTab ? (tone === 'success' ? '#047857' : '#92400E') : '#6B7280',
    fontSize: 11, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <Card tone={active.length > 0 ? 'warning' : 'success'} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--foreground)' }}>파티 재정비 대상</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>재정비 대상 탭은 기존 상세 체크리스트 · 파티 재시작 YES 시 완료 탭으로 이동</div>
        </div>
        <StatusBadge tone={active.length > 0 ? 'warning' : 'success'}>{active.length}건 남음</StatusBadge>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button onClick={() => setTab('active')} style={tabButtonStyle(tab === 'active', 'warning')}>재정비 대상 {active.length}</button>
        <button onClick={() => setTab('completed')} style={tabButtonStyle(tab === 'completed', 'success')}>완료한 파티 재정비 대상 {completed.length}</button>
      </div>

      {tab === 'active' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: '9px 10px' }}>
            <div style={{ fontSize: 10, color: '#C2410C', fontWeight: 800 }}>이용중 0명</div>
            <div style={{ fontSize: 18, color: '#9A3412', fontWeight: 900, marginTop: 2 }}>{noCurrentUsers}건</div>
          </div>
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '9px 10px' }}>
            <div style={{ fontSize: 10, color: '#92400E', fontWeight: 800 }}>7일 이내 만료</div>
            <div style={{ fontSize: 18, color: '#78350F', fontWeight: 900, marginTop: 2 }}>{expiringSoon}건</div>
          </div>
        </div>
      )}

      {currentItems.length === 0 ? (
        <div style={{ background: tab === 'completed' ? '#F0FDF4' : '#FFFBEB', border: `1px solid ${tab === 'completed' ? '#BBF7D0' : '#FDE68A'}`, borderRadius: 12, padding: '12px', fontSize: 12, color: tab === 'completed' ? '#047857' : '#92400E', fontWeight: 800 }}>
          {tab === 'completed' ? '아직 완료한 파티 재정비 대상이 없어요.' : '현재 처리할 파티 재정비 대상이 없어요.'}
        </div>
      ) : tab === 'active' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {active.slice(0, 8).map((item) => {
            const target = item.target;
            return (
              <div key={item.key} style={{ background: '#fff', border: '1px solid #F3F4F6', borderRadius: 12, padding: '10px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 900, color: '#1E1B4B' }}>{target.serviceType}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: target.reason === 'no-current-users' ? '#C2410C' : '#92400E', background: target.reason === 'no-current-users' ? '#FFEDD5' : '#FEF3C7', borderRadius: 999, padding: '2px 7px' }}>{target.reasonLabel}</span>
                      <span style={{ fontSize: 10, fontWeight: 900, color: '#7C3AED', background: '#F5F3FF', borderRadius: 999, padding: '2px 7px' }}>{item.progress.done}/{item.progress.total}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {target.accountEmail} · 최근 파티원 {target.lastMemberName}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: target.reason === 'expiring-soon' ? '#EF4444' : '#9A3412', fontWeight: 900 }}>
                      {target.daysUntilExpiry !== null ? (target.daysUntilExpiry <= 0 ? '만료됨' : `D-${target.daysUntilExpiry}`) : '날짜 없음'}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{shortDate(target.expiryDate)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 9, background: '#FAFAFF', border: '1px solid #EDE9FE', borderRadius: 12, padding: '9px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: '#1E1B4B', fontWeight: 900 }}>해당 계정으로 또 다시 파티 모집을 진행할건가?</div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <ChoiceButton label="Y" active={item.recruitAgain === true} onClick={() => onUpdate(item.key, { recruitAgain: true })} tone="green" />
                      <ChoiceButton label="N" active={item.recruitAgain === false} onClick={() => onUpdate(item.key, { recruitAgain: false })} tone="red" />
                    </div>
                  </div>
                  {item.recruitAgain === true && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                      <ChecklistRow label="기존 구독이 유지됐는가" value={item.subscriptionKept} onChange={(value) => onUpdate(item.key, { subscriptionKept: value })} />
                      {item.subscriptionKept === true && (
                        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 9, padding: '7px 8px' }}>
                          <label style={{ display: 'block', fontSize: 10, color: '#047857', fontWeight: 900, marginBottom: 5 }}>구독 결제일은 매달 몇일인가?</label>
                          <input type="number" inputMode="numeric" min={1} max={31} value={item.subscriptionBillingDay} placeholder="예: 15" onChange={(event) => onUpdate(item.key, { subscriptionBillingDay: event.target.value })} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #A7F3D0', borderRadius: 8, padding: '7px 9px', fontSize: 11, color: '#065F46', fontWeight: 700, outline: 'none', fontFamily: 'inherit', background: '#fff' }} />
                        </div>
                      )}
                      <ChecklistRow label="기존 파티원 프로필을 제거했는가" value={item.profileRemoved} onChange={(value) => onUpdate(item.key, { profileRemoved: value })} />
                      <ChecklistRow label="모든 기기에서 로그아웃했는가" value={item.devicesLoggedOut} onChange={(value) => onUpdate(item.key, { devicesLoggedOut: value })} />
                      <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 9, padding: '7px 8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: '#4338CA', fontWeight: 900 }}>비밀번호 변경 준비</span>
                          <button onClick={() => onUpdate(item.key, { passwordChanged: true, changedPassword: generateMaintenancePassword() })} style={{ border: 'none', borderRadius: 8, padding: '6px 9px', background: '#4F46E5', color: '#fff', fontSize: 10, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>
                            랜덤 12자리 비밀번호 생성
                          </button>
                        </div>
                        {item.changedPassword && <div style={{ fontSize: 11, color: '#312E81', fontWeight: 900, marginBottom: 6, letterSpacing: 0.5 }}>변경 예정 비밀번호: {item.changedPassword}</div>}
                        <ChecklistRow label="비밀번호를 변경했는가" value={item.passwordChanged} onChange={(value) => onUpdate(item.key, { passwordChanged: value })} />
                      </div>
                      {item.passwordChanged === true && !item.changedPassword.trim() && (
                        <div style={{ fontSize: 10, color: '#DC2626', fontWeight: 800, padding: '0 2px' }}>먼저 랜덤 비밀번호를 만들거나 변경된 비밀번호를 입력해주세요.</div>
                      )}
                      <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 9, padding: '7px 8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, color: '#C2410C', fontWeight: 900 }}>Email Dashboard PIN</span>
                          <button onClick={() => onRegeneratePin(item)} disabled={regeneratingPinKey === item.key} style={{ border: 'none', borderRadius: 8, padding: '6px 9px', background: '#F97316', color: '#fff', fontSize: 10, fontWeight: 900, cursor: regeneratingPinKey === item.key ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: regeneratingPinKey === item.key ? 0.65 : 1 }}>
                            {regeneratingPinKey === item.key ? '변경 확인중...' : '랜덤 6자리 PIN 변경'}
                          </button>
                        </div>
                        {item.generatedPin && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 6 }}>
                            <div style={{ fontSize: 11, color: '#9A3412', fontWeight: 900 }}>변경된 PIN: {item.generatedPin}</div>
                            <div style={{ fontSize: 10, color: '#059669', fontWeight: 900 }}>PIN 변경 확인됨 · Email #{item.generatedPinAliasId || '-'}</div>
                            {item.generatedPinAliasId && <button onClick={() => window.open(`https://email-verify.xyz/email/mail/${item.generatedPinAliasId}`, '_blank', 'noopener,noreferrer')} style={{ alignSelf: 'flex-start', border: 'none', borderRadius: 8, padding: '5px 8px', background: '#FFEDD5', color: '#C2410C', fontSize: 10, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>이메일 새탭 열기</button>}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#fff', borderRadius: 9, padding: '6px 7px' }}>
                          <span style={{ fontSize: 10, color: '#4B5563', fontWeight: 800 }}>PIN 번호를 변경했는가</span>
                          <span style={{ display: 'flex', gap: 4 }}>
                            <ChoiceButton label="Y" active={item.pinStillUnchanged === false} onClick={() => onUpdate(item.key, { pinStillUnchanged: false })} tone="green" />
                            <ChoiceButton label="N" active={item.pinStillUnchanged === true} onClick={() => onUpdate(item.key, { pinStillUnchanged: true })} tone="red" />
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {item.recruitAgain === false && (
                    <ChecklistRow label="구독을 해지했는가" value={item.subscriptionCancelled} onChange={(value) => onUpdate(item.key, { subscriptionCancelled: value })} />
                  )}
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 7 }}>다음 조치: {item.nextAction}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginTop: 9 }}>
                  <div style={{ background: '#F9FAFB', borderRadius: 9, padding: '6px 7px' }}>
                    <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 800 }}>이용중</div>
                    <div style={{ fontSize: 12, color: '#111827', fontWeight: 900 }}>{target.usingCount}/{target.totalSlots}</div>
                  </div>
                  <button onClick={onGoManage} style={{ border: 'none', borderRadius: 9, padding: '6px 7px', background: '#EDE9FE', color: '#7C3AED', fontSize: 10, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>계정 관리</button>
                  <button onClick={onGoWrite} style={{ border: 'none', borderRadius: 9, padding: '6px 7px', background: '#DCFCE7', color: '#047857', fontSize: 10, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }}>모집 글</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {completed.slice(0, 12).map((item) => {
            const target = item.target;
            return (
              <div key={item.key} style={{ background: '#fff', border: '1px solid #BBF7D0', borderRadius: 12, padding: '9px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 900, color: '#1E1B4B' }}>{target.serviceType}</span>
                      <span style={{ fontSize: 10, fontWeight: 900, color: '#047857', background: '#DCFCE7', borderRadius: 999, padding: '2px 7px' }}>재시작 완료</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {target.accountEmail} · 최근 {target.lastMemberName || '없음'} · {target.usingCount}/{target.totalSlots}
                    </div>
                  </div>
                  <button onClick={() => onUpdate(item.key, { recruitAgain: null })} style={{ border: 'none', borderRadius: 9, padding: '6px 8px', background: '#F3F4F6', color: '#6B7280', fontSize: 10, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>대상 복귀</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ChatAlertsPanel({ alerts, unreadAlerts, unreadCount, loading, updatedAt, error, onOpenChat }: { alerts: ChatAlertItem[]; unreadAlerts: ChatAlertItem[]; unreadCount: number; loading: boolean; updatedAt: string | null; error: string | null; onOpenChat: () => void }) {
  return (
    <Card tone={unreadCount > 0 ? 'warning' : 'info'} style={{ marginBottom: 16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Bell size={16} color={unreadCount > 0 ? '#F59E0B' : '#7C3AED'} />
          <div>
            <div style={{ fontSize:14, fontWeight:900, color:'#1E1B4B' }}>실시간 채팅 알림</div>
            <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>{updatedAt ? `${updatedAt} 갱신` : '구매자 문의를 확인하는 중'}</div>
          </div>
        </div>
        <button onClick={onOpenChat} style={{ border:'none', borderRadius:999, padding:'6px 10px', background:'#EDE9FE', color:'#7C3AED', fontSize:11, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
          <MessageCircle size={13} /> 채팅 열기
        </button>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        <div style={{ flex:1, background:'#FFF7ED', border:'1px solid #FED7AA', borderRadius:12, padding:'8px 10px' }}>
          <div style={{ fontSize:17, fontWeight:950, color:'#F97316' }}>{unreadCount}</div>
          <div style={{ fontSize:10, color:'#9CA3AF' }}>안 읽은 문의</div>
        </div>
        <div style={{ flex:1, background:'#F8F6FF', border:'1px solid #EDE9FE', borderRadius:12, padding:'8px 10px' }}>
          <div style={{ fontSize:17, fontWeight:950, color:'#7C3AED' }}>{alerts.length}</div>
          <div style={{ fontSize:10, color:'#9CA3AF' }}>최근 문의 표시</div>
        </div>
      </div>
      {error && <div style={{ background:'#FFF0F0', color:'#EF4444', borderRadius:10, padding:'8px 10px', fontSize:11, marginBottom:8 }}>{error}</div>}
      {unreadAlerts.length > 0 && (
        <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:14, padding:'10px 11px', marginBottom:10 }}>
          <div style={{ fontSize:12, fontWeight:900, color:'#92400E', marginBottom:8 }}>안 읽은 문의 내용</div>
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {unreadAlerts.map(alert => (
              <div key={`unread-${alert.id}`} style={{ background:'#fff', border:'1px solid #FEF3C7', borderRadius:11, padding:'8px 9px' }}>
                <div style={{ fontSize:11, fontWeight:900, color:'#1E1B4B', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{alert.buyerName} · {alert.serviceType}</div>
                <div style={{ fontSize:11, color:'#6B21A8', marginTop:5, lineHeight:1.35, wordBreak:'break-word' }}>“{alert.message}”</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loading && alerts.length === 0 ? (
        <div style={{ color:'#9CA3AF', fontSize:12, padding:'10px 0' }}>채팅 알림 조회중...</div>
      ) : alerts.length === 0 ? (
        <div style={{ color:'#9CA3AF', fontSize:12, padding:'10px 0' }}>새 구매자 문의가 없어요.</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {alerts.map(alert => (
            <div key={alert.id} style={{ background: alert.unread ? '#FFFBEB' : '#FAFAFF', border:`1px solid ${alert.unread ? '#FDE68A' : '#EDE9FE'}`, borderRadius:13, padding:'10px 11px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:900, color:'#1E1B4B', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{alert.title}</div>
                  <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{alert.productName}</div>
                </div>
                {alert.unread && <span style={{ fontSize:9, fontWeight:900, color:'#B45309', background:'#FEF3C7', borderRadius:999, padding:'3px 7px', flexShrink:0 }}>NEW</span>}
              </div>
              <div style={{ fontSize:11, color:'#6B21A8', marginTop:7, lineHeight:1.35, wordBreak:'break-word' }}>“{alert.message}”</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── HomePage ────────────────────────────────────────────────────
export default function HomePage() {
  const [data, setData] = useState<ManageData | null>(null);
  const [manuals, setManuals] = useState<ManualMember[]>([]);
  const [sellerStatus, setSellerStatus] = useState<SellerStatus | null>(null);
  const [safeMode, setSafeMode] = useState<SafeModeState | null>(null);
  const [safeModeSaving, setSafeModeSaving] = useState(false);
  const [chatAlerts, setChatAlerts] = useState<ChatAlertItem[]>([]);
  const [unreadChatAlerts, setUnreadChatAlerts] = useState<ChatAlertItem[]>([]);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatUpdatedAt, setChatUpdatedAt] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [partyMaintenanceChecklistStore, setPartyMaintenanceChecklistStore] = useState<PartyMaintenanceChecklistStore>({});
  const [regeneratingPinKey, setRegeneratingPinKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();

  const fetchSellerStatus = async () => {
    try {
      const res = await fetch('/api/seller/status');
      if (!res.ok) return;
      setSellerStatus(await res.json() as SellerStatus);
    } catch { /* 상태판은 보조 정보라 홈 조회를 막지 않음 */ }
  };

  const fetchSafeMode = async () => {
    try {
      const res = await fetch('/api/safe-mode');
      if (!res.ok) return;
      setSafeMode(await res.json() as SafeModeState);
    } catch { /* 안전 모드 배너는 보조 정보라 홈 조회를 막지 않음 */ }
  };

  const fetchPartyMaintenanceChecklists = async () => {
    try {
      const res = await fetch('/api/party-maintenance-checklists');
      if (!res.ok) return;
      const json = await res.json() as { store?: PartyMaintenanceChecklistStore };
      setPartyMaintenanceChecklistStore(json.store || {});
    } catch { /* 체크리스트는 보조 정보라 홈 조회를 막지 않음 */ }
  };

  const updatePartyMaintenanceChecklist = async (key: string, patch: Partial<PartyMaintenanceChecklistState>) => {
    setPartyMaintenanceChecklistStore(prev => mergePartyMaintenanceChecklistState(prev, key, patch, 'dashboard'));
    try {
      const res = await fetch(`/api/party-maintenance-checklists/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json() as { ok?: boolean; store?: PartyMaintenanceChecklistStore };
      if (res.ok && json.store) setPartyMaintenanceChecklistStore(json.store);
    } catch { await fetchPartyMaintenanceChecklists(); }
  };


  const regeneratePartyMaintenancePin = async (item: PartyMaintenanceChecklistItem<PartyMaintenanceTarget>) => {
    if (regeneratingPinKey) return;
    setRegeneratingPinKey(item.key);
    try {
      const res = await fetch(`/api/party-maintenance-checklists/${encodeURIComponent(item.key)}/pin/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail: item.target.accountEmail, serviceType: item.target.serviceType }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; store?: PartyMaintenanceChecklistStore };
      if (!res.ok || !json.ok) throw new Error(json.error || 'PIN 재생성 실패');
      if (json.store) setPartyMaintenanceChecklistStore(json.store);
    } catch (e: any) {
      window.alert(e.message || 'PIN 재생성 실패');
      await fetchPartyMaintenanceChecklists();
    } finally {
      setRegeneratingPinKey(null);
    }
  };

  const fetchChatAlerts = async (silent = false) => {
    if (!silent) setChatLoading(true);
    setChatError(null);
    try {
      const res = await fetch('/api/chat/rooms');
      const json = await res.json() as { rooms?: ChatAlertRoom[]; unreadCount?: number; updatedAt?: string; error?: string };
      if (!res.ok) throw new Error(json.error || '채팅 알림 조회 실패');
      const alerts = buildChatAlerts(json.rooms || [], 5);
      const unreadAlerts = buildUnreadChatAlerts(json.rooms || [], 5);
      setChatAlerts(alerts);
      setUnreadChatAlerts(unreadAlerts);
      setChatUnreadCount(json.unreadCount ?? unreadAlerts.length);
      setChatUpdatedAt(json.updatedAt ? formatShortTime(json.updatedAt) : formatShortTime(new Date().toISOString()));
    } catch (e: any) {
      setChatError(e.message || '채팅 알림 조회 실패');
    } finally {
      if (!silent) setChatLoading(false);
    }
  };

  const toggleSafeMode = async () => {
    if (!safeMode || safeModeSaving) return;
    const nextEnabled = !safeMode.enabled;
    const reason = nextEnabled
      ? window.prompt('안전 모드를 켜는 이유를 입력하세요.', safeMode.reason || '운영 점검')
      : window.prompt('안전 모드를 끄는 이유를 입력하세요.', '정상화');
    if (reason === null) return;
    setSafeModeSaving(true);
    try {
      const res = await fetch('/api/safe-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, reason, updatedBy: 'dashboard' }),
      });
      const json = await res.json() as any;
      if (!res.ok) throw new Error(json.error || '안전 모드 변경 실패');
      setSafeMode(json as SafeModeState);
    } catch (e: any) {
      window.alert(e.message || '안전 모드 변경 실패');
    } finally {
      setSafeModeSaving(false);
    }
  };

  const fetchData = async () => {
    setLoading(true); setError(null);
    try {
      const cookies = loadCookies();
      const cs = cookies[0];
      const [manageRes, manualsRes] = await Promise.all([
        fetch('/api/my/management', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cs.id === AUTO_COOKIE_ID
            ? {}
            : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }),
        }),
        fetch('/api/manual-members'),
      ]);
      const manageJson = await manageRes.json() as any;
      const manualsJson = await manualsRes.json() as any;
      if (!manageRes.ok) setError(manageJson.error || '조회 실패');
      else {
        setData(manageJson);
        setManuals(manualsJson.members || []);
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData(); fetchSellerStatus(); fetchSafeMode(); fetchChatAlerts(); fetchPartyMaintenanceChecklists();
    const timer = window.setInterval(() => fetchChatAlerts(true), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = data ? buildServiceStats(data, manuals) : [];
  const partyMaintenanceTargets = data ? buildPartyMaintenanceTargets(data) : [];
  const partyMaintenanceChecklistItems = buildPartyMaintenanceChecklistItems(partyMaintenanceTargets, partyMaintenanceChecklistStore);
  const totalUsing = stats.reduce((s, st) => s + st.usingMembers, 0);
  const totalMaxSlots = stats.reduce((s, st) => s + st.maxSlots, 0);
  const totalAccounts = stats.reduce((s, st) => s + st.accountCount, 0);
  const totalVacancy = totalMaxSlots - totalUsing;

  // 추가공유 ON/OFF 상태 (profit.tsx에서 저장된 상태 읽음)
  const getExtraShareState = (): Record<string, boolean> => {
    try { return JSON.parse(localStorage.getItem('graytag_extra_share_v2') || '{}'); } catch { return {}; }
  };

  // 수익 종합 계산
  const summary = calcProfitSummary(data, getExtraShareState(), manuals);
  const manualIncome = summary.manualIncome;
  const realNetProfit = summary.netProfit;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} 기준`;
  };

  const formatShortTime = (iso: string | null) => {
    if (!iso) return 'unknown';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'unknown';
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const statusBadgeStyle = (ok: boolean) => ({
    fontSize: 10,
    fontWeight: 800,
    color: ok ? '#059669' : '#DC2626',
    background: ok ? '#D1FAE5' : '#FEE2E2',
    borderRadius: 999,
    padding: '2px 7px',
  });

  const statusCards = sellerStatus ? [
    { label: 'Graytag 세션', ok: sellerStatus.session.ok, value: sellerStatus.session.status, sub: formatShortTime(sellerStatus.session.lastCheck) },
    { label: 'PollDaemon', ok: sellerStatus.pollDaemon.ok, value: sellerStatus.pollDaemon.ok ? 'OK' : '확인 필요', sub: `실패 ${sellerStatus.pollDaemon.consecutiveFailures}회` },
    { label: '언더커터', ok: sellerStatus.undercutter.enabled, value: sellerStatus.undercutter.enabled ? 'ON' : 'OFF', sub: `${sellerStatus.undercutter.intervalMinutes}분 · ${formatShortTime(sellerStatus.undercutter.lastRun)}` },
    { label: '자동응답', ok: sellerStatus.autoReply.enabled, value: sellerStatus.autoReply.enabled ? 'ON' : 'OFF', sub: `로그 ${formatShortTime(sellerStatus.autoReply.lastLogAt)}` },
  ] : [];

  return (
    <div style={{ padding: '20px 16px 0' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>{"파티 대시보드"}</h1>
          {data?.updatedAt && (
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>{formatTime(data.updatedAt)}{"최신화"}</p>
          )}
        </div>
        <button onClick={() => { fetchData(); fetchSellerStatus(); fetchSafeMode(); fetchChatAlerts(); fetchPartyMaintenanceChecklists(); }} disabled={loading}
          style={{ background: '#EDE9FE', border: 'none', borderRadius: 12, padding: '8px 12px', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#7C3AED', fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} strokeWidth={2.5} />}
          {loading ? '조회중' : '새로고침'}
        </button>
      </div>

      {safeMode && (
        <div style={{
          background: safeMode.enabled ? '#FEF2F2' : '#ECFDF5',
          border: `1.5px solid ${safeMode.enabled ? '#FCA5A5' : '#A7F3D0'}`,
          borderRadius: 16,
          padding: '12px 14px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <ShieldAlert size={18} color={safeMode.enabled ? '#DC2626' : '#059669'} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: safeMode.enabled ? '#991B1B' : '#065F46' }}>
                안전 모드 {safeMode.enabled ? 'ON · 위험 작업 잠김' : 'OFF'}
              </div>
              <div style={{ fontSize: 11, color: safeMode.enabled ? '#B91C1C' : '#047857', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {safeMode.reason || '사유 없음'}{safeMode.updatedAt ? ` · ${formatShortTime(safeMode.updatedAt)}` : ''}
              </div>
            </div>
          </div>
          <button onClick={toggleSafeMode} disabled={safeModeSaving}
            style={{ border: 'none', borderRadius: 999, padding: '7px 11px', fontSize: 11, fontWeight: 800, color: '#fff', background: safeMode.enabled ? '#059669' : '#DC2626', cursor: safeModeSaving ? 'not-allowed' : 'pointer', opacity: safeModeSaving ? 0.65 : 1, flexShrink: 0 }}>
            {safeModeSaving ? '저장중' : (safeMode.enabled ? '끄기' : '켜기')}
          </button>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 18, padding: 14, marginBottom: 16, boxShadow: '0 2px 14px rgba(30,27,75,0.08)', border: '1px solid #F3F4F6' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <CheckCircle2 size={16} color={sellerStatus?.ok ? '#059669' : '#F59E0B'} />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#1E1B4B' }}>통합 상태판</span>
          </div>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>{sellerStatus ? formatShortTime(sellerStatus.generatedAt) : '조회중'}</span>
        </div>
        {sellerStatus ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {statusCards.map(card => (
                <div key={card.label} style={{ background: '#FAFAFF', border: '1px solid #EEF2FF', borderRadius: 12, padding: '10px 11px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4B5563' }}>{card.label}</span>
                    <span style={statusBadgeStyle(card.ok)}>{card.value}</span>
                  </div>
                  <p style={{ fontSize: 10, color: '#9CA3AF', margin: '6px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.sub}</p>
                </div>
              ))}
            </div>
            {sellerStatus.warnings.length > 0 && (
              <div style={{ marginTop: 10, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '8px 10px', color: '#92400E', fontSize: 11, lineHeight: 1.5 }}>
                <b>경고</b> · {sellerStatus.warnings.slice(0, 2).join(' · ')}{sellerStatus.warnings.length > 2 ? ` 외 ${sellerStatus.warnings.length - 2}건` : ''}
              </div>
            )}
          </>
        ) : (
          <div style={{ height: 58, borderRadius: 12, background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 12 }}>상태를 불러오는 중...</div>
        )}
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: '#DC2626', fontSize: 13 }}>{error}</div>
      )}

      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#EDE9FE', borderRadius: 20, height: 130, opacity: 0.5 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[1, 2, 3, 4].map(i => <div key={i} style={{ background: '#fff', borderRadius: 16, height: 140, opacity: 0.4 }} />)}
          </div>
        </div>
      )}

      {data && (
        <>
          <section style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 900, color: 'var(--foreground)', margin: 0 }}>오늘 상태</h2>
              <StatusBadge tone={sellerStatus?.ok ? 'success' : 'warning'}>{sellerStatus?.ok ? '운영 정상' : '확인 필요'}</StatusBadge>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <StatCard label="계정" value={`${totalAccounts}개`} helper="활성 운영 계정" tone="info" />
              <StatCard label="파티원" value={`${totalUsing}/${totalMaxSlots}`} helper={`빈자리 ${Math.max(0, totalVacancy)}개`} tone={totalVacancy > 0 ? 'warning' : 'success'} />
              <StatCard label="예상 순수익" value={`${realNetProfit.toLocaleString()}원`} helper={manualIncome > 0 ? `수동 +${manualIncome.toLocaleString()}원 포함` : '풀파티 기준'} tone={realNetProfit >= 0 ? 'success' : 'danger'} />
              <StatCard label="채움률" value={`${totalMaxSlots > 0 ? Math.round(totalUsing / totalMaxSlots * 100) : 0}%`} helper="서비스 전체 기준" tone={totalVacancy > 0 ? 'warning' : 'success'} />
            </div>
          </section>

          <Card tone={sellerStatus?.warnings?.length || safeMode?.enabled ? 'warning' : 'success'} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--foreground)' }}>위험 알림</div>
              <StatusBadge tone={sellerStatus?.warnings?.length || safeMode?.enabled ? 'warning' : 'success'}>
                {sellerStatus?.warnings?.length || safeMode?.enabled ? '조치 필요' : '이상 없음'}
              </StatusBadge>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {safeMode?.enabled
                ? `안전 모드 ON · ${safeMode.reason || '위험 작업이 잠겨 있어요'}`
                : sellerStatus?.warnings?.length
                  ? sellerStatus.warnings.slice(0, 3).join(' · ')
                  : '세션, 자동화, 파티 채움 상태에 큰 이상이 없어요.'}
            </div>
          </Card>

          <ChatAlertsPanel
            alerts={chatAlerts}
            unreadAlerts={unreadChatAlerts}
            unreadCount={chatUnreadCount}
            loading={chatLoading}
            updatedAt={chatUpdatedAt}
            error={chatError}
            onOpenChat={() => navigate('/chat')}
          />

          <section style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 15, fontWeight: 900, color: 'var(--foreground)', margin: '0 0 10px' }}>바로가기</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { path: '/price', title: '가격', desc: '시세 확인', emoji: '📊' },
                { path: '/profit', title: '수익', desc: '정산 보기', emoji: '💰' },
                { path: '/write', title: '글 작성', desc: '모집/게시', emoji: '✍️' },
                { path: '/manage', title: '관리', desc: '계정 운영', emoji: '🧩' },
              ].map(item => (
                <button key={item.path} onClick={() => navigate(item.path)} style={{ background: 'var(--surface-raised)', border: '1.5px solid var(--border)', borderRadius: 16, padding: '12px 13px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow-card)' }}>
                  <span style={{ fontSize: 22 }}>{item.emoji}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 900, color: 'var(--foreground)' }}>{item.title}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{item.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 배너 */}
          <div style={{
            background: realNetProfit >= 0
              ? 'linear-gradient(135deg, #059669 0%, #10B981 100%)'
              : 'linear-gradient(135deg, #DC2626 0%, #EF4444 100%)',
            borderRadius: 20, padding: '20px', marginBottom: 20, color: '#fff',
          }}>
            <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 12, padding: '12px', marginBottom: 14, textAlign: 'center' }}>
              <p style={{ fontSize: 11, opacity: 0.75, margin: 0, fontWeight: 500 }}>{"풀파티 기준 월 순수익"}</p>
              <p style={{ fontSize: 32, fontWeight: 800, margin: '6px 0 0', lineHeight: 1 }}>{realNetProfit.toLocaleString()}{"원"}</p>
              {manualIncome > 0 && (
                <p style={{ fontSize: 10, opacity: 0.7, margin: '4px 0 0' }}>{"수동 포함 +"}{manualIncome.toLocaleString()}{"원"}</p>
              )}
              {/* 서비스별 순수익 상세 */}
              {summary.svcDetails.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {summary.svcDetails.map(d => (
                    <div key={d.serviceType} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 7, padding: '4px 10px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{d.serviceType} {d.accountCount}계정</span>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{(d.netProfit / 10000).toFixed(1)}만원</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 8px' }}>
                  {"채운 비율: "}
                  {totalMaxSlots > 0 ? Math.round(totalUsing / totalMaxSlots * 100) : 0}
                  {"% ("}
                  {totalUsing}
                  {"/"}
                  {totalMaxSlots}
                  {")"}
                </p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>
                    {"📊 "}{totalAccounts}{"계정 · 빈자리 "}{totalVacancy}
                  </span>
                  {manualIncome > 0 && (
                    <span style={{ fontSize: 10, opacity: 0.8 }}>
                      {"✋ 수동 +"}{manualIncome.toLocaleString()}{"원"}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 12, padding: '10px 14px', textAlign: 'right', minWidth: 120 }}>
                <p style={{ fontSize: 24, fontWeight: 800, margin: 0, lineHeight: 1 }}>
                  {totalUsing}<span style={{ fontSize: 12, opacity: 0.8 }}>{"/"}{totalMaxSlots}</span>
                </p>
                <p style={{ fontSize: 9, opacity: 0.7, margin: '4px 0 0' }}>
                  {totalMaxSlots - totalUsing > 0 ? `빈자리 ${totalVacancy}개` : '풀파티'}
                </p>
              </div>
            </div>
          </div>

          <PartyMaintenancePanel
            items={partyMaintenanceChecklistItems}
            regeneratingPinKey={regeneratingPinKey}
            onUpdate={updatePartyMaintenanceChecklist}
            onRegeneratePin={regeneratePartyMaintenancePin}
            onGoManage={() => navigate('/manage')}
            onGoWrite={() => navigate('/write')}
          />

          {/* 서비스별 카드 */}
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', margin: '0 0 12px' }}>{"서비스별 현황"}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {stats.map(st => {
              const cat = findCategory(st.serviceType);
              const color = cat?.color || '#6B7280';
              const bg = cat?.bg || '#F3F4F6';
              const logo = cat?.logo;
              const isPositive = st.monthlyNet >= 0;
              const pct = Math.round(st.fillRatio * 100);
              const vacancy = st.maxSlots - st.usingMembers;
              const isGood = pct >= 50;
              return (
                <div key={st.serviceType} style={{ background: '#fff', borderRadius: 16, padding: '14px', boxShadow: '0 2px 12px rgba(167,139,250,0.10)', border: `1.5px solid ${bg}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {logo && <img src={logo} alt={st.serviceType} style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                      <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 6, padding: '2px 6px' }}>
                        {st.serviceType.length > 6 ? st.serviceType.slice(0, 5) + '..' : st.serviceType}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: '#9CA3AF' }}>{st.accountCount}{"계정"}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: '#1E1B4B', lineHeight: 1 }}>{st.usingMembers}</span>
                    <span style={{ fontSize: 13, color: '#9CA3AF', fontWeight: 500 }}>{"/"}{st.maxSlots}{"명"}</span>
                    {vacancy > 0 && <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600, marginLeft: 'auto' }}>{"빈 "}{vacancy}</span>}
                  </div>
                  <div style={{ width: '100%', height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 3, background: pct >= 100 ? '#059669' : pct >= 50 ? color : '#F59E0B', transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: isGood ? '#ECFDF5' : '#FFF0F0', borderRadius: 8, padding: '5px 8px' }}>
                    {isGood ? <TrendingUp size={11} color="#059669" /> : <TrendingDown size={11} color="#EF4444" />}
                    <span style={{ fontSize: 12, fontWeight: 700, color: isGood ? '#059669' : '#EF4444' }}>
                      {pct}{"% 채움"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {stats.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF', fontSize: 13 }}>{"활성 파티가 없어요"}</div>
          )}

          {/* Quick Nav */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {[
              { path: '/profit', icon: <Wallet size={20} color="#059669" strokeWidth={2} />, bg: '#ECFDF5', title: '수익 상세 분석', desc: '구독료 · 수수료 · 달력 · 정산' },
              { path: '/my', icon: <User size={20} color="#A78BFA" strokeWidth={2} />, bg: '#EDE9FE', title: '내 계정 파티원 조회', desc: '쿠키 기반 계정 연결' },
            ].map(item => (
              <button key={item.path} onClick={() => navigate(item.path)}
                style={{ width: '100%', background: '#fff', border: '1.5px solid #EDE9FE', borderRadius: 16, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(167,139,250,0.08)' }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: item.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.icon}</div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1E1B4B' }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{item.desc}</div>
                </div>
                <ChevronRight size={18} color="#A78BFA" style={{ marginLeft: 'auto' }} />
              </button>
            ))}
          </div>

          {/* 파티 피드백 */}
          <PartyFeedbackPanel manageData={data} />

          {/* 관리 페이지 인라인 */}
          <div style={{ marginTop: 8, borderTop: '2px solid #EDE9FE', paddingTop: 4 }}>
            <ManagePage />
          </div>

          {/* 월간 캘린더 + 구독설정 */}
          <div style={{ marginTop: 8, borderTop: '2px solid #EDE9FE', paddingTop: 4 }}>
            <MonthlyCalendarWidget data={data} />
          </div>

          {/* 일별 파티 유입 그래프 */}
          <div style={{ marginTop: 8, borderTop: '2px solid #EDE9FE', paddingTop: 4 }}>
            <DailyInflowChart data={data} />
          </div>
        </>
      )}
    </div>
  );
}
