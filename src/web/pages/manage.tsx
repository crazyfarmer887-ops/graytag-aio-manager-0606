import { useState, useEffect } from "react";
import { CATEGORIES } from "../lib/constants";
import { buildAccountSlotStates, dedupeRecruitingProducts, mergeRecruitingProducts, type SlotState } from "../lib/account-slots";
import { removeRecruitingProductFromManageData } from "../lib/manage-optimistic";
import { assertAutoDeliveryInput, buildAutoFillDeliveryMemo, buildFillPartyAccessMember, buildFillProductModel, findExactPasswordForAccount, requireExactAliasMemoForAutoFill } from "../../lib/graytag-fill";
import { generateProfileNickname, generateUniqueProfileNicknames, isValidProfileNickname, normalizeProfileNickname } from "../../lib/profile-nickname";
import type { PartyMaintenanceChecklistStore } from "../../lib/party-maintenance-checklist";
import { getGeneratedAccountCreationCopy } from "../../lib/generated-accounts";
import { buildPartyAccessDeliveryTemplate, PARTY_ACCESS_URL_PLACEHOLDER } from "../../lib/party-access-template";
import { parseJsonResponse } from "../lib/fetch-json";
import { RefreshCw, KeyRound, Mail, ChevronDown, ChevronRight, TrendingUp, Loader2, AlertCircle, ExternalLink, Calendar, UserX, Megaphone, PlusCircle, X, UserPlus, Trash2, Wifi, WifiOff } from "lucide-react";

interface OnSaleProduct {
  productUsid: string; productName: string; productType: string;
  price: string; purePrice: number; endDateTime: string; remainderDays: number;
  keepAcct: string; keepPasswd: string; keepMemo?: string;
}

interface Member {
  dealUsid: string; name: string | null; status: string; statusName: string;
  price: string; purePrice: number; realizedSum: number; progressRatio: string;
  startDateTime: string | null; endDateTime: string | null; remainderDays: number; source: 'after'|'before';
}
interface Account {
  email: string; serviceType: string; members: Member[]; usingCount: number;
  activeCount: number; totalSlots: number; totalIncome: number; totalRealizedIncome: number; expiryDate: string | null; keepPasswd?: string;
  generatedAccount?: {
    id: string;
    createdAt: string;
    paymentStatus: 'pending' | 'paid';
    paidAt: string | null;
    emailId: number | string;
    pin: string;
    memo: string;
    sourceServiceType?: string;
    linkedServiceType?: string;
    tvingLoginId?: string;
    wavveEmail?: string;
  };
}
interface ServiceGroup { serviceType: string; accounts: Account[]; totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number; }
interface EmailAlias { id: number | string; email: string; enabled?: boolean; }
interface ExistingPinCacheEntry { pin: string; emailId: number | string | null; loading: boolean; checked: boolean; message?: string; }
interface ManageData {
  services: ServiceGroup[];
  onSaleByKeepAcct: Record<string, OnSaleProduct[]>;
  summary: { totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number; totalAccounts: number; };
  updatedAt: string;
}

const AUTO_COOKIE_ID = '__session_keeper__';
const AUTO_COOKIE: CookieSet = { id: AUTO_COOKIE_ID, label: '자동 (Session Keeper)', AWSALB: '', AWSALBCORS: '', JSESSIONID: '__auto__' };
const STORAGE_KEY = 'graytag_cookies_v2';
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => { try { return [AUTO_COOKIE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')]; } catch { return [AUTO_COOKIE]; } };

// 서비스별 파티 최대 인원
const PARTY_MAX: Record<string, number> = {
  '넷플릭스': 5,
  '디즈니플러스': 6,
  '왓챠플레이': 4,
  '티빙': 4,
  '웨이브': 4,
  '티빙+웨이브': 4,
};
const getPartyMax = (svc: string) => PARTY_MAX[svc] || 6;

const USING_SET = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
const ACTIVE_SET = new Set(['Using','UsingNearExpiration','Delivered','Delivering','DeliveredAndCheckPrepaid','LendingAcceptanceWaiting','Reserved','OnSale']);
const VERIFYING_SET = new Set(['DeliveredAndCheckPrepaid']);
const isAccountCheckingMember = (m: Pick<Member, 'status' | 'statusName'>) => VERIFYING_SET.has(m.status) || String(m.statusName || '').includes('계정확인중') || String(m.statusName || '').includes('계정 확인중');

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  Using:                       { label:'이용 중',   color:'#7C3AED', bg:'#F5F3FF' },
  UsingNearExpiration:         { label:'만료 임박',  color:'#D97706', bg:'#FFFBEB' },
  DeliveredAndCheckPrepaid:    { label:'계정 확인중', color:'#2563EB', bg:'#EFF6FF' },
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
  CancelByLendingRejection:    { label:'취소(거절)', color:'#EF4444', bg:'#FFF0F0' },
};

const bge = (s: string, n: string) => (String(n || '').includes('계정확인중') || String(n || '').includes('계정 확인중'))
  ? { label:'계정 확인중', color:'#2563EB', bg:'#EFF6FF' }
  : (STATUS_BADGE[s] || { label:n||s, color:'#6B7280', bg:'#F3F4F6' });
const svcLogo = (s: string) => CATEGORIES.find(c => c.label===s || s.includes(c.label.slice(0,3)))?.logo;
const svcColors = (s: string) => { const c = CATEGORIES.find(c => c.label===s || s.includes(c.label.slice(0,3))); return { color: c?.color||'#6B7280', bg: c?.bg||'#F3F4F6' }; };
const fmtMoney = (n: number) => n > 0 ? n.toLocaleString()+'원' : '-';
const fmtDate = (s: string|null) => s ? s.replace(/\s/g,'').replace(/\.(?=\S)/g,'/').replace(/\.$/, '') : '-';

// 파티 기간 계산 (startDateTime ~ endDateTime)
const calcPartyDuration = (members: Member[]): { startDate: string | null; endDate: string | null; totalDays: number } => {
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const m of members) {
    if (m.startDateTime && (!earliest || m.startDateTime < earliest)) earliest = m.startDateTime;
    if (m.endDateTime && (!latest || m.endDateTime > latest)) latest = m.endDateTime;
  }

  if (!earliest || !latest) return { startDate: earliest, endDate: latest, totalDays: 0 };

  const start = new Date(earliest);
  const end = new Date(latest);
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  return { startDate: earliest, endDate: latest, totalDays };
};

// ─── 수동 파티원 타입 ─────────────────────────────────────
interface ManualMember {
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

const SOURCE_PRESETS = ['당근마켓', '에브리타임', '지인소개', '번개장터', '카카오톡', '네이버카페', '인스타그램', '기타'];

const stableRandomFromSeed = (seed: string) => {
  let state = Array.from(seed || 'graytag').reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

type FilterMode = 'using'|'active'|'all';

function ManualResponseQueuePanel() {
  const [source, setSource] = useState('카카오톡');
  const [buyerName, setBuyerName] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    if (!buyerName.trim() && !message.trim()) return;
    setSaving(true); setResult(null);
    try {
      const res = await fetch('/api/operations-center/manual-response-queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, buyerName, message, priority: source === '카카오톡' ? 'normal' : 'low' }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || '응대 큐 저장 실패');
      setBuyerName(''); setMessage(''); setResult('응대 큐에 저장했어요. 홈 운영센터와 채팅 화면에서 확인하세요.');
    } catch (e: any) { setResult(e.message || '응대 큐 저장 실패'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ background:'#fff', borderRadius:18, padding:14, marginBottom:14, boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:'1.5px solid #F3F0FF' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:900, color:'#1E1B4B' }}>수동 고객/카카오톡 응대 큐</div>
          <div style={{ fontSize:11, color:'#9CA3AF', marginTop:3 }}>대시보드 밖에서 온 문의를 운영센터에 남겨두기</div>
        </div>
        <span style={{ fontSize:10, color:'#7C3AED', background:'#F5F3FF', borderRadius:999, padding:'4px 8px', fontWeight:900 }}>운영센터 저장</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'110px 1fr', gap:8, marginBottom:8 }}>
        <select value={source} onChange={e => setSource(e.target.value)} style={{ border:'1px solid #EDE9FE', borderRadius:10, padding:'8px', fontSize:12, fontFamily:'inherit' }}>
          <option value="카카오톡">카카오톡</option>
          <option value="수동고객">수동고객</option>
          <option value="그레이태그">그레이태그</option>
          <option value="기타">기타</option>
        </select>
        <input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="고객명/닉네임" style={{ border:'1px solid #EDE9FE', borderRadius:10, padding:'8px 10px', fontSize:12, fontFamily:'inherit' }} />
      </div>
      <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="문의 내용 또는 해야 할 답변 메모" rows={2} style={{ width:'100%', boxSizing:'border-box', border:'1px solid #EDE9FE', borderRadius:12, padding:'9px 10px', fontSize:12, fontFamily:'inherit', resize:'vertical' }} />
      <button onClick={submit} disabled={saving || (!buyerName.trim() && !message.trim())} style={{ marginTop:8, width:'100%', border:'none', borderRadius:12, padding:'10px', background:'#7C3AED', color:'#fff', fontSize:12, fontWeight:900, cursor:saving?'not-allowed':'pointer', opacity:saving?0.65:1 }}>{saving ? '저장중' : '응대 큐에 추가'}</button>
      {result && <div style={{ marginTop:8, fontSize:11, color:result.includes('실패')?'#EF4444':'#059669', fontWeight:800 }}>{result}</div>}
    </div>
  );
}

export default function ManagePage() {
  const cookies = loadCookies();
  const [selectedId, setSelectedId] = useState(cookies[0]?.id||'');
  const [data, setData] = useState<ManageData|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [openService, setOpenService] = useState<string|null>(null);
  const [openAccount, setOpenAccount] = useState<string|null>(null);
  const [filter, setFilter] = useState<FilterMode>('using');

  // 메꾸기 모달
  const [fillModal, setFillModal] = useState<{ email: string; serviceType: string; keepAcct: string; keepPasswd: string; keepMemo: string; vacancy: number; productName: string; category: string; } | null>(null);
  const [fillEndDate, setFillEndDate] = useState('');
  const [fillPrice, setFillPrice] = useState('');
  const [fillDailyPrice, setFillDailyPrice] = useState('');
  const [fillPriceMode, setFillPriceMode] = useState<'total'|'daily'>('total');
  const [fillCount, setFillCount] = useState(1);
  const [fillKeepMemo, setFillKeepMemo] = useState('');
  const [fillProfileNickname, setFillProfileNickname] = useState('');
  const [fillAliasStatus, setFillAliasStatus] = useState<{ ok: boolean; message: string; email?: string; serviceType?: string; memo?: string; emailId?: number | string | null; pin?: string | null; emailAccessUrl?: string } | null>(null);
  const [fillAliasLoading, setFillAliasLoading] = useState(false);
  const [fillLoading, setFillLoading] = useState(false);
  const [fillResult, setFillResult] = useState<string|null>(null);
  const [fillRank, setFillRank] = useState<{rank:number;total:number}|null>(null);

  // ─── 수동 파티원 관련 state ────────────────────────────
  const [manualMembers, setManualMembers] = useState<ManualMember[]>([]);
  const [addManualModal, setAddManualModal] = useState<{
    serviceType: string;
    accountEmail: string;
  } | null>(null);
  const [mmName, setMmName] = useState('');
  const [mmStartDate, setMmStartDate] = useState('');
  const [mmEndDate, setMmEndDate] = useState('');
  const [mmPrice, setMmPrice] = useState('');
  const [mmSource, setMmSource] = useState('');
  const [mmSourceCustom, setMmSourceCustom] = useState('');
  const [mmMemo, setMmMemo] = useState('');
  const [mmLoading, setMmLoading] = useState(false);
  const [mmResult, setMmResult] = useState<string|null>(null);

  // ─── 세션 상태 모니터링 ────────────────────────────
  const [sessionStatus, setSessionStatus] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [accountCreateService, setAccountCreateService] = useState('티빙+웨이브');
  const [accountCreatePrefix, setAccountCreatePrefix] = useState('');
  const [accountCreateLoading, setAccountCreateLoading] = useState(false);
  const [accountCreateResult, setAccountCreateResult] = useState<string | null>(null);
  const accountCreateCopy = getGeneratedAccountCreationCopy(accountCreateService);
  const [emailAliases, setEmailAliases] = useState<EmailAlias[]>([]);
  const [existingPinCache, setExistingPinCache] = useState<Record<string, ExistingPinCacheEntry>>({});
  const [maintenanceChecklistStore, setMaintenanceChecklistStore] = useState<PartyMaintenanceChecklistStore>({});
  const [pinResetLoadingKey, setPinResetLoadingKey] = useState<string | null>(null);
  const [pinResetNoticeKey, setPinResetNoticeKey] = useState<string | null>(null);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [passwordSaveLoadingKey, setPasswordSaveLoadingKey] = useState<string | null>(null);
  const [accessLinkLoadingKey, setAccessLinkLoadingKey] = useState<string | null>(null);
  const [accessLinkResult, setAccessLinkResult] = useState<{ key: string; url: string } | null>(null);

  const fetchEmailAliases = async () => {
    try {
      const res = await fetch('/api/sl/aliases?page=0');
      const json = await res.json() as { aliases?: EmailAlias[] };
      setEmailAliases((json.aliases || []).filter(alias => alias.enabled !== false));
    } catch { setEmailAliases([]); }
  };

  const accountCredentialKey = (acct: Pick<Account, 'serviceType' | 'email'>) => `${acct.serviceType}:${acct.email}`;

  const findEmailAliasId = (acct: Account): string | number | null => {
    if (acct.generatedAccount?.emailId) return acct.generatedAccount.emailId;
    const exact = emailAliases.find(alias => String(alias.email || '').toLowerCase() === acct.email.toLowerCase());
    return exact?.id ?? null;
  };

  const findExistingPinRecordForAccount = (acct: Account) => existingPinCache[accountCredentialKey(acct)];

  const loadExistingPinForAccount = async (acct: Account) => {
    const key = accountCredentialKey(acct);
    const cached = existingPinCache[key];
    if (cached?.loading || cached?.checked) return;
    setExistingPinCache(prev => {
      const current = prev[key];
      if (current?.loading || current?.checked) return prev;
      return { ...prev, [key]: { pin: current?.pin || '', emailId: current?.emailId ?? findEmailAliasId(acct), loading: true, checked: false, message: '기존 PIN 로딩중' } };
    });
    try {
      const res = await fetch(`/api/email-alias-fill?email=${encodeURIComponent(acct.email)}&serviceType=${encodeURIComponent(acct.serviceType)}`);
      const json = await res.json() as { ok?: boolean; pin?: string | null; emailId?: number | string | null; message?: string };
      const pin = typeof json.pin === 'string' ? json.pin.trim() : '';
      setExistingPinCache(prev => ({
        ...prev,
        [key]: {
          pin,
          emailId: json.emailId ?? findEmailAliasId(acct),
          loading: false,
          checked: true,
          message: res.ok && json.ok && pin ? '기존 PIN 로드 완료' : (json.message || '기존 PIN 없음'),
        },
      }));
    } catch (e: any) {
      setExistingPinCache(prev => ({
        ...prev,
        [key]: { pin: '', emailId: findEmailAliasId(acct), loading: false, checked: true, message: e?.message || '기존 PIN 로드 실패' },
      }));
    }
  };

  const openEmailDashboardForAccount = (acct: Account) => {
    const emailId = findEmailAliasId(acct);
    if (!emailId) return;
    window.open(`https://email-verify.xyz/email/mail/${emailId}`, '_blank', 'noopener,noreferrer');
  };

  const fetchMaintenanceChecklists = async () => {
    try {
      const res = await fetch('/api/party-maintenance-checklists');
      if (!res.ok) return;
      const json = await res.json() as { store?: PartyMaintenanceChecklistStore };
      setMaintenanceChecklistStore(json.store || {});
    } catch { setMaintenanceChecklistStore({}); }
  };

  const findMaintenanceCredentialForAccount = (acct: Account) => {
    const key = accountCredentialKey(acct);
    const state = maintenanceChecklistStore[key];
    const existingPin = existingPinCache[key];
    const password = state?.changedPassword || acct.keepPasswd || '';
    const pin = state?.generatedPin || acct.generatedAccount?.pin || existingPin?.pin || '';
    const emailId = state?.generatedPinAliasId || acct.generatedAccount?.emailId || existingPin?.emailId || findEmailAliasId(acct);
    if (!password && !pin) return null;
    return { password, pin, emailId, source: state?.changedPassword || state?.generatedPin ? 'maintenance' : acct.generatedAccount ? 'generated' : existingPin?.pin ? 'email-dashboard' : 'graytag' };
  };

  const copyText = async (value: string) => {
    if (!value) return;
    try { await navigator.clipboard?.writeText(value); } catch { /* 복사는 브라우저 권한에 따름 */ }
  };

  const handleRegeneratePin = async (acct: Account) => {
    const key = `${acct.serviceType}:${acct.email}`;
    setPinResetLoadingKey(key);
    try {
      const res = await fetch(`/api/party-maintenance-checklists/${encodeURIComponent(key)}/pin/regenerate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail: acct.email, serviceType: acct.serviceType }),
      });
      const json = await res.json() as any;
      if (!res.ok || !json.ok) throw new Error(json.error || 'PIN 번호 재설정 실패');
      setMaintenanceChecklistStore(json.store || { ...maintenanceChecklistStore, [key]: json.item });
      if (json.item?.generatedPin) {
        setExistingPinCache(prev => ({
          ...prev,
          [key]: {
            pin: json.item.generatedPin,
            emailId: json.item.generatedPinAliasId ?? findEmailAliasId(acct),
            loading: false,
            checked: true,
            message: 'PIN 번호 재설정 완료',
          },
        }));
      }
      setPinResetNoticeKey(key);
      await doFetch(undefined, true);
    } catch (e: any) {
      alert(e.message || 'PIN 번호 재설정 실패');
    } finally {
      setPinResetLoadingKey(null);
    }
  };

  const handleSaveLatestPassword = async (acct: Account) => {
    const key = `${acct.serviceType}:${acct.email}`;
    const nextPassword = (passwordDrafts[key] ?? findMaintenanceCredentialForAccount(acct)?.password ?? '').trim();
    if (!nextPassword) { alert('저장할 비밀번호를 입력해주세요.'); return; }
    setPasswordSaveLoadingKey(key);
    try {
      const res = await fetch(`/api/party-maintenance-checklists/${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruitAgain: true, passwordChanged: true, changedPassword: nextPassword }),
      });
      const json = await res.json() as any;
      if (!res.ok || !json.ok) throw new Error(json.error || '최신 비밀번호 저장 실패');
      setMaintenanceChecklistStore(json.store || { ...maintenanceChecklistStore, [key]: json.item });
      setPasswordDrafts(prev => ({ ...prev, [key]: nextPassword }));
      setPinResetNoticeKey(key);
    } catch (e: any) {
      alert(e.message || '최신 비밀번호 저장 실패');
    } finally {
      setPasswordSaveLoadingKey(null);
    }
  };

  const updateAccountExitChecklist = async (acct: Account, patch: Record<string, unknown>) => {
    const key = `${acct.serviceType}:${acct.email}`;
    try {
      const res = await fetch(`/api/party-maintenance-checklists/${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruitAgain: true, ...patch }),
      });
      const json = await res.json() as any;
      if (!res.ok || !json.ok) throw new Error(json.error || '퇴장 체크리스트 저장 실패');
      setMaintenanceChecklistStore(json.store || { ...maintenanceChecklistStore, [key]: json.item });
    } catch (e: any) {
      alert(e.message || '퇴장 체크리스트 저장 실패');
    }
  };

  const buildEmailAccessUrl = (emailId?: number | string | null) => emailId ? `https://email-verify.xyz/email/mail/${encodeURIComponent(String(emailId))}` : '';

  const createPartyAccessLink = async (acct: Account, member: { kind: 'graytag' | 'manual'; memberId: string; memberName: string; profileName?: string; status: string; statusName?: string; startDateTime?: string | null; endDateTime?: string | null }, copyMode: 'url' | 'template' = 'url') => {
    const key = `${acct.serviceType}:${acct.email}:${member.kind}:${member.memberId}:${copyMode}`;
    const credential = findMaintenanceCredentialForAccount(acct);
    setAccessLinkLoadingKey(key);
    try {
      const res = await fetch('/api/party-access-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: acct.serviceType,
          accountEmail: acct.email,
          fallbackPassword: credential?.password || acct.keepPasswd || '',
          fallbackPin: credential?.pin || acct.generatedAccount?.pin || '',
          profileName: member.profileName || member.memberName,
          emailAccessUrl: buildEmailAccessUrl(credential?.emailId ?? findEmailAliasId(acct)),
          member,
        }),
      });
      const json = await res.json() as any;
      if (!res.ok || !json.ok || !json.url) throw new Error(json.error || '접근 링크 만들기 실패');
      await copyText(copyMode === 'template' ? buildPartyAccessDeliveryTemplate(json.url) : json.url);
      setAccessLinkResult({ key, url: json.url });
    } catch (e: any) {
      alert(e.message || '접근 링크 만들기 실패');
    } finally {
      setAccessLinkLoadingKey(null);
    }
  };

  const fetchSessionStatus = async () => {
    try {
      const res = await fetch('/api/session/status');
      const json = await res.json() as any;
      setSessionStatus(json);
    } catch {}
  };

  // 수동 파티원 조회
  const fetchManualMembers = async () => {
    try {
      const res = await fetch('/api/manual-members');
      const json = await res.json() as any;
      setManualMembers(json.members || []);
    } catch {}
  };

  const handleCreateGeneratedAccount = async () => {
    if (!accountCreateService || accountCreateLoading) return;
    setAccountCreateLoading(true); setAccountCreateResult(null);
    try {
      const res = await fetch('/api/generated-accounts/create', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ serviceType: accountCreateService, aliasPrefix: accountCreatePrefix.trim() }),
      });
      const json = await res.json() as any;
      if (!res.ok || !json.account) throw new Error(json.error || '계정 생성 실패');
      setAccountCreateResult(`${json.account.email} 생성 완료 · 계정 관리에 표시됨 · 결제 체크 대기`);
      setAccountCreatePrefix('');
      await doFetch(undefined, true);
    } catch (e: any) { setAccountCreateResult(`오류: ${e.message}`); }
    finally { setAccountCreateLoading(false); }
  };

  const toggleGeneratedAccountPaid = async (acct: Account, paid: boolean) => {
    if (!acct.generatedAccount) return;
    const previous = acct.generatedAccount.paymentStatus;
    setData(prev => prev ? {
      ...prev,
      services: prev.services.map(s => ({
        ...s,
        accounts: s.accounts.map(a => a.generatedAccount?.id === acct.generatedAccount?.id
          ? { ...a, generatedAccount: { ...a.generatedAccount!, paymentStatus: paid ? 'paid' : 'pending', paidAt: paid ? new Date().toISOString() : null } }
          : a),
      })),
    } : prev);
    try {
      const res = await fetch(`/api/generated-accounts/${encodeURIComponent(acct.generatedAccount.id)}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ paymentStatus: paid ? 'paid' : 'pending' }),
      });
      if (!res.ok) throw new Error('결제 체크 저장 실패');
      await doFetch(undefined, true);
    } catch (e: any) {
      setAccountCreateResult(`오류: ${e.message}`);
      setData(prev => prev ? {
        ...prev,
        services: prev.services.map(s => ({
          ...s,
          accounts: s.accounts.map(a => a.generatedAccount?.id === acct.generatedAccount?.id
            ? { ...a, generatedAccount: { ...a.generatedAccount!, paymentStatus: previous, paidAt: previous === 'paid' ? a.generatedAccount!.paidAt : null } }
            : a),
        })),
      } : prev);
    }
  };

  const handleDeleteGeneratedAccount = async (acct: Account) => {
    if (!acct.generatedAccount) return;
    if (!window.confirm('방금 생성한 계정을 삭제할까요? SimpleLogin alias도 함께 삭제돼요.')) return;
    try {
      const res = await fetch(`/api/generated-accounts/${encodeURIComponent(acct.generatedAccount.id)}`, { method:'DELETE' });
      const json = await res.json().catch(() => ({})) as any;
      if (!res.ok) throw new Error(json.error || '생성 계정 삭제 실패');
      setAccountCreateResult(`${acct.email} 삭제 완료`);
      await doFetch(undefined, true);
    } catch (e: any) {
      setAccountCreateResult(`오류: ${e.message}`);
    }
  };

  useEffect(() => {
    fetchManualMembers();
    fetchSessionStatus();
    fetchEmailAliases();
    fetchMaintenanceChecklists();
    // 30초마다 세션 상태 갱신
    const sessionInterval = setInterval(fetchSessionStatus, 30000);
    return () => clearInterval(sessionInterval);
  }, []);

  // 수동 파티원 추가
  const handleAddManual = async () => {
    if (!addManualModal || !mmName || !mmStartDate || !mmEndDate || !mmPrice) return;
    setMmLoading(true); setMmResult(null);
    try {
      const finalSource = mmSource === '기타' ? mmSourceCustom : mmSource;
      const res = await fetch('/api/manual-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceType: addManualModal.serviceType,
          accountEmail: addManualModal.accountEmail,
          memberName: mmName,
          startDate: mmStartDate,
          endDate: mmEndDate,
          price: parseInt(mmPrice.replace(/[^0-9]/g, '') || '0'),
          source: finalSource,
          memo: mmMemo,
        }),
      });
      const json = await res.json() as any;
      if (json.ok) {
        setMmResult('파티원 추가 완료');
        await fetchManualMembers();
        setTimeout(() => { setAddManualModal(null); setMmResult(null); }, 1500);
      } else {
        setMmResult(`오류: ${json.error}`);
      }
    } catch (e: any) { setMmResult(`오류: ${e.message}`); }
    finally { setMmLoading(false); }
  };

  // 수동 파티원 삭제
  const handleDeleteManual = async (id: string) => {
    if (!window.confirm('이 수동 파티원을 삭제하시겠습니까?')) return;
    try {
      await fetch(`/api/manual-members/${id}`, { method: 'DELETE' });
      await fetchManualMembers();
    } catch {}
  };

  // 수동 파티원 일당 계산
  const calcManualDaily = () => {
    if (!mmStartDate || !mmEndDate || !mmPrice) return null;
    const s = new Date(mmStartDate);
    const e = new Date(mmEndDate);
    const days = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
    const total = parseInt(mmPrice.replace(/[^0-9]/g, '') || '0');
    if (total <= 0) return null;
    return { daily: Math.ceil(total / days), days, total };
  };

  // 계정별 수동 파티원 필터
  const getManualForAccount = (email: string, serviceType: string) =>
    manualMembers.filter(m => m.accountEmail === email && m.serviceType === serviceType);

  const loadFillMemoFromEmailDashboard = async (email: string, serviceType: string, fallbackMemo = '', profileNickname = fillProfileNickname) => {
    setFillAliasLoading(true);
    setFillAliasStatus(null);
    try {
      const res = await fetch(`/api/email-alias-fill?email=${encodeURIComponent(email)}&serviceType=${encodeURIComponent(serviceType)}`);
      const data = await res.json() as any;
      if (res.ok && data?.ok && data.memo) {
        const deliveryMemo = buildAutoFillDeliveryMemo(profileNickname, PARTY_ACCESS_URL_PLACEHOLDER);
        const emailAccessUrl = buildEmailAccessUrl(data.emailId);
        setFillKeepMemo(deliveryMemo);
        setFillAliasStatus({ ok: true, message: `이메일 대시보드 DB 확인됨: #${data.emailId} · 등록 시 실제 접근 링크 자동 생성`, email, serviceType, memo: deliveryMemo, emailId: data.emailId ?? null, pin: data.pin ?? null, emailAccessUrl });
        return deliveryMemo;
      }

      const missing = Array.isArray(data?.missing) ? data.missing : [];
      const message = missing.includes('email')
        ? '이 계정 이메일이 이메일 대시보드 alias 목록에 없어요.'
        : missing.includes('pin')
          ? '이 계정 이메일의 PIN 번호가 이메일 대시보드에 없어요.'
          : (data?.message || data?.error || '이메일/PIN 정보를 찾지 못했어요.');
      setFillKeepMemo(fallbackMemo || '');
      setFillAliasStatus({ ok: false, message, email, serviceType });
      return '';
    } catch (e: any) {
      setFillKeepMemo(fallbackMemo || '');
      setFillAliasStatus({ ok: false, message: `이메일 대시보드 조회 실패: ${e.message}`, email, serviceType });
      return '';
    } finally {
      setFillAliasLoading(false);
    }
  };

  const findPasswdByEmail = (email: string, serviceType: string, onSaleList: OnSaleProduct[]): string => {
    return findExactPasswordForAccount(email, serviceType, onSaleList, data?.onSaleByKeepAcct || {});
  };
  const [fillRankLoading, setFillRankLoading] = useState(false);

  const isTransientFetchError = (e: any) => /Load failed|Failed to fetch|NetworkError|aborted|abort|terminated/i.test(String(e?.message || e || ''));
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const fetchManagementJson = async (body: Record<string, unknown>, forceRefresh: boolean) => {
    let lastError: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 70000);
      try {
        const res = await fetch(forceRefresh ? '/api/my/management?refresh=1' : '/api/my/management', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Cache-Control': forceRefresh ? 'no-cache' : 'no-store' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const json = await parseJsonResponse<any>(res, '계정 관리');
        return { res, json };
      } catch (e: any) {
        lastError = e;
        if (attempt > 0 || !isTransientFetchError(e)) throw e;
        await sleep(450);
      } finally {
        window.clearTimeout(timeoutId);
      }
    }
    throw lastError;
  };

  const doFetch = async (id?: string, forceRefresh = false) => {
    const cs = cookies.find(c => c.id===(id||selectedId));
    if (!cs) return;
    setLoading(true); setError(null); setData(null);
    try {
      const body = cs.id === AUTO_COOKIE_ID ? (forceRefresh ? { forceRefresh: true } : {}) : { AWSALB:cs.AWSALB, AWSALBCORS:cs.AWSALBCORS, JSESSIONID:cs.JSESSIONID };
      const { res, json } = await fetchManagementJson(body, forceRefresh);
      if (!res.ok) setError(json.error || `계정 관리 조회 실패 (${res.status})`);
      else { setData(json); if (json.services?.[0]) setOpenService(json.services[0].serviceType); void fetchEmailAliases(); void fetchMaintenanceChecklists(); }
    } catch (e: any) {
      const message = e?.name === 'AbortError'
        ? '계정 관리 조회가 70초 안에 끝나지 않았어요. 잠시 후 다시 조회해주세요.'
        : isTransientFetchError(e)
          ? '네트워크 요청이 중간에 끊겼어요. 다시 조회를 눌러주세요. 계속 뜨면 화면을 새로고침해주세요.'
          : (e?.message || '계정 관리 조회 실패');
      setError(message);
    }
    finally { setLoading(false); }
  };

  // 빈자리 판단: 계정별로 (totalSlots - usingCount - 수동파티원)개 빈자리
  const getVacancyInfo = (acct: Account) => {
    const maxSlots = getPartyMax(acct.serviceType);
    const manualCount = getManualForAccount(acct.email, acct.serviceType).filter(m => m.status === 'active').length;
    const occupiedSlots = acct.usingCount + manualCount;
    const vacancy = Math.max(0, maxSlots - occupiedSlots);
    const onSaleList = dedupeRecruitingProducts(data?.onSaleByKeepAcct?.[acct.email] || [])
      .filter(p => !p.productType || p.productType === acct.serviceType);
    const recruiting = onSaleList.length;
    const unfilled = Math.max(0, vacancy - recruiting);
    return { vacancy, recruiting, unfilled, onSaleList, manualCount };
  };

  // 서비스 카테고리 매핑
  const svcToCategory = (svcType: string) => {
    const map: Record<string, string> = {
      '웨이브': 'wavve', '디즈니플러스': 'disney', '왓챠플레이': 'WatchaPlay',
      '넷플릭스': 'Netflix', '티빙': 'tving', '티빙+웨이브': 'wavve', '유튜브': 'youtube',
      '라프텔': 'laftel', '쿠팡플레이': 'coupang', 'AppleOne': 'AppleOne', '프라임비디오': 'prime',
    };
    return map[svcType] || svcType;
  };

  // 메꾸기 일당/총액 계산
  const fillCalcDays = () => {
    if (!fillEndDate) return 0;
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.ceil((new Date(fillEndDate).getTime() - today.getTime()) / (1000*60*60*24));
  };
  const fillCalcInfo = () => {
    const days = fillCalcDays();
    if (days <= 0) return null;
    if (fillPriceMode === 'total') {
      const total = parseInt(fillPrice.replace(/,/g,'')) || 0;
      if (total <= 0) return null;
      return { daily: Math.ceil(total / days), total, days };
    } else {
      const daily = parseInt(fillDailyPrice.replace(/,/g,'')) || 0;
      if (daily <= 0) return null;
      return { daily, total: daily * days, days };
    }
  };
  const fillInfo = fillCalcInfo();
  const fillFinalPrice = fillPriceMode === 'total'
    ? (parseInt(fillPrice.replace(/,/g,'')) || 0)
    : (fillInfo?.total || 0);

  const toggleFillPriceMode = () => {
    if (fillPriceMode === 'total') {
      const info = fillCalcInfo();
      if (info) setFillDailyPrice(info.daily.toLocaleString());
      setFillPriceMode('daily');
    } else {
      const info = fillCalcInfo();
      if (info) setFillPrice(info.total.toLocaleString());
      setFillPriceMode('total');
    }
  };

  // 가격 비교 (일당 기준)
  const fetchFillRank = async (daily: number, catKey: string) => {
    setFillRankLoading(true); setFillRank(null);
    try {
      const res = await fetch(`/api/prices/${catKey}`);
      const json = await res.json() as any;
      const products: any[] = json.products || [];
      const cheaper = products.filter((p: any) => p.pricePerDayNum < daily).length;
      setFillRank({ rank: cheaper + 1, total: json.count || products.length });
    } catch { setFillRank(null); }
    finally { setFillRankLoading(false); }
  };

  const handleFill = async () => {
    if (!fillModal || !fillEndDate || fillFinalPrice < 1000) return;
    if (!isValidProfileNickname(fillProfileNickname)) { setFillResult('자동 등록 차단: 프로필명은 한글 3~4글자로 입력해주세요.'); return; }
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) return;
    setFillLoading(true); setFillResult(null);
    const aliasMatchesModal = fillAliasStatus?.email === fillModal.keepAcct && fillAliasStatus?.serviceType === fillModal.serviceType;
    const aliasInputError = requireExactAliasMemoForAutoFill({ statusOk: fillAliasStatus?.ok === true && aliasMatchesModal, memo: fillKeepMemo, expectedMemo: fillAliasStatus?.memo });
    if (aliasInputError) {
      setFillResult(`자동 등록 차단: ${aliasInputError}`);
      setFillLoading(false);
      return;
    }
    const deliveryInputErrorBeforeCreate = assertAutoDeliveryInput({ keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: fillKeepMemo });
    if (deliveryInputErrorBeforeCreate) {
      setFillResult(`자동 등록 차단: ${deliveryInputErrorBeforeCreate}`);
      setFillLoading(false);
      return;
    }

    const count = Math.max(1, Math.min(fillCount, fillModal.vacancy));
    const profileNicknames = generateUniqueProfileNicknames(count, fillProfileNickname);
    let success = 0;
    const createdProducts: OnSaleProduct[] = [];
    const priceNum = fillFinalPrice;

    const toGraytagDate = (ds: string) => {
      const d = new Date(ds);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T2359`;
    };

    for (let i = 0; i < count; i++) {
      try {
        const usidProfileNickname = profileNicknames[i] || generateProfileNickname();
        const accessEndDateTime = toGraytagDate(fillEndDate);
        const productModel = buildFillProductModel({
          category: fillModal.category,
          endDate: accessEndDateTime,
          price: priceNum,
          productName: fillModal.productName,
          serviceType: fillModal.serviceType,
        });
        const body = cs.id === AUTO_COOKIE_ID ? { productModel } : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID, productModel };
        const res = await fetch('/api/post/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json() as any;
        if (!res.ok || !json.productUsid) {
          setFillResult(`등록 실패: ${json.error || '알 수 없는 오류'}`);
          continue;
        }

        const member = buildFillPartyAccessMember({ productUsid: json.productUsid, profileNickname: usidProfileNickname, endDateTime: toGraytagDate(fillEndDate) });
        const accessRes = await fetch('/api/party-access-links', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceType: fillModal.serviceType,
            accountEmail: fillModal.keepAcct,
            fallbackPassword: fillModal.keepPasswd,
            fallbackPin: fillAliasStatus?.pin || '',
            profileName: usidProfileNickname,
            emailAccessUrl: fillAliasStatus?.emailAccessUrl || buildEmailAccessUrl(fillAliasStatus?.emailId),
            member,
          }),
        });
        const accessJson = await accessRes.json().catch(() => ({})) as any;
        if (!accessRes.ok || !accessJson.ok || !accessJson.url) {
          setFillResult(`접근 링크 생성 실패: ${accessJson.error || '알 수 없는 오류'}`);
          continue;
        }
        const usidMemo = buildAutoFillDeliveryMemo(usidProfileNickname, accessJson.url);

        // keepAcct 설정
        const deliveryInputError = assertAutoDeliveryInput({ keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: usidMemo });
        if (deliveryInputError) {
          setFillResult(`계정 자동전달 준비 실패: ${deliveryInputError}`);
          continue;
        }
        const keepBody = cs.id === AUTO_COOKIE_ID
          ? { productUsid: json.productUsid, keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: usidMemo }
          : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID, productUsid: json.productUsid, keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: usidMemo };
        const keepRes = await fetch('/api/post/keepAcct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(keepBody) });
        if (!keepRes.ok) {
          const keepJson = await keepRes.json().catch(() => ({})) as any;
          setFillResult(`계정 등록 실패: ${keepJson.error || '알 수 없는 오류'}`);
          continue;
        }
        createdProducts.push({
          productUsid: String(json.productUsid),
          productName: fillModal.productName,
          productType: fillModal.serviceType,
          price: `${priceNum.toLocaleString()}원`,
          purePrice: priceNum,
          endDateTime: toGraytagDate(fillEndDate),
          remainderDays: fillCalcDays(),
          keepAcct: fillModal.keepAcct,
          keepPasswd: fillModal.keepPasswd,
          keepMemo: usidMemo,
        });
        success++;
      } catch {}
      if (i < count - 1) await new Promise(r => setTimeout(r, 800));
    }

    setFillLoading(false);
    setFillResult(`${success}/${count}개 등록 완료`);
    if (createdProducts.length > 0) {
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          onSaleByKeepAcct: {
            ...prev.onSaleByKeepAcct,
            [fillModal.keepAcct]: mergeRecruitingProducts(prev.onSaleByKeepAcct?.[fillModal.keepAcct] || [], createdProducts),
          },
        };
      });
    }
    if (success > 0) setTimeout(() => { setFillModal(null); setFillResult(null); doFetch(undefined, true); }, 3000);
  };


  // graytag endDateTime ("20250620T2359") -> "YYYY-MM-DD"
  const parseGraytagDate = (dt: string): string => {
    if (!dt) return "";
    // 20250620T2359
    const compact = dt.match(/^(\d{4})(\d{2})(\d{2})T/);
    if (compact) return compact[1] + "-" + compact[2] + "-" + compact[3];
    // 2025-07-11, 2025.07.11, 2025/07/11
    const iso = dt.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
    if (iso) return iso[1] + "-" + iso[2].padStart(2,"0") + "-" + iso[3].padStart(2,"0");
    // 26. 07. 11 (YY. MM. DD)
    const short = dt.match(/(\d{2})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
    if (short) {
      const y = parseInt(short[1]);
      const fullYear = y < 50 ? 2000 + y : 1900 + y;
      return fullYear + "-" + short[2].padStart(2,"0") + "-" + short[3].padStart(2,"0");
    }
    return "";
  };

  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0]; };

  // 자동 쿠키가 항상 있으므로 빈 상태 가드 제거됨

  const isActiveManualMember = (m: ManualMember) => m.status === 'active';
  const serviceManualUsingCount = (svc: ServiceGroup) => svc.accounts.reduce((total, acct) => total + getManualForAccount(acct.email, acct.serviceType).filter(isActiveManualMember).length, 0);
  const totalManualUsingCount = data?.services.reduce((total, svc) => total + serviceManualUsingCount(svc), 0) ?? 0;

  const sum = data?.summary;
  const actualTotalAccounts = data?.services.reduce((total, svc) => total + svc.accounts.filter((acct) => (
    acct.email !== '(직접전달)' &&
    (acct.usingCount > 0 || getManualForAccount(acct.email, acct.serviceType).some((m) => m.status === 'active'))
  )).length, 0) ?? 0;

  return (
    <div style={{ padding:'20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1E1B4B', margin:0 }}>계정 관리</h1>
          <p style={{ fontSize:12, color:'#9CA3AF', margin:'4px 0 0' }}>
            {data?.updatedAt ? `${new Date(data.updatedAt).getHours().toString().padStart(2,'0')}:${new Date(data.updatedAt).getMinutes().toString().padStart(2,'0')} 기준` : '이메일 계정별 파티원 현황'}
          </p>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => doFetch()} disabled={loading} style={{ background:'#A78BFA', border:'none', borderRadius:12, padding:'8px 14px', fontSize:13, color:'#fff', cursor:loading?'not-allowed':'pointer', fontWeight:600, fontFamily:'inherit', opacity:loading?0.7:1, display:'flex', alignItems:'center', gap:6 }}>
            {loading ? <Loader2 size={14} style={{ animation:'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
            {loading ? '조회중' : '조회'}
          </button>
          {data && !loading && (() => {
            let totalUnfilled = 0;
            for (const svc of data.services) {
              for (const acct of svc.accounts) {
                if (acct.email === '(직접전달)') continue;
                const vi = getVacancyInfo(acct);
                totalUnfilled += vi.unfilled;
              }
            }
            if (totalUnfilled === 0) return null;
            return (
              <button disabled title="전체 메꾸기는 계정별 미리보기와 Email/PIN 확인 단계가 추가된 뒤 다시 열 예정이에요."
                style={{ background:'#FCA5A5', border:'none', borderRadius:12, padding:'8px 14px', fontSize:13, color:'#fff', cursor:'not-allowed', fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', gap:6, opacity:0.75 }}>
                <PlusCircle size={14} />
                전체 메꾸기 미리보기 필요 ({totalUnfilled})
              </button>
            );
          })()}
        </div>
      </div>

      {/* 계정 선택 */}
      {cookies.length > 1 && (
        <div className="no-scrollbar" style={{ display:'flex', gap:8, marginBottom:12, overflowX:'auto' }}>
          {cookies.map(cs => (
            <button key={cs.id} onClick={() => setSelectedId(cs.id)} style={{ flexShrink:0, padding:'6px 14px', borderRadius:20, border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', background: selectedId===cs.id ? '#A78BFA' : '#fff', color: selectedId===cs.id ? '#fff' : '#6B7280', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }}>
              {cs.label}
            </button>
          ))}
        </div>
      )}

      {/* 전체 메꾸기 결과 */}
      {fillResult && !fillModal && (
        <div style={{ background: fillResult.includes('실패') ? '#FFF0F0' : '#F0FDF4', borderRadius:14, padding:'10px 16px', marginBottom:12, fontSize:13, fontWeight:600, color: fillResult.includes('실패') ? '#EF4444' : '#059669' }}>
          {fillResult}
        </div>
      )}

      {/* 초기 안내 */}
      {!data && !loading && !error && (
        <div style={{ background:'#EDE9FE', borderRadius:16, padding:20, textAlign:'center' }}>
          <Mail size={32} color="#C4B5FD" style={{ margin:'0 auto 10px' }} />
          <div style={{ fontSize:14, fontWeight:600, color:'#7C3AED' }}>조회 버튼을 눌러주세요</div>
          <div style={{ fontSize:12, color:'#9CA3AF', marginTop:4 }}>이메일 계정별 파티원 · 수입 현황</div>
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{ background:'#FFF0F0', borderRadius:16, padding:'14px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600, color:'#EF4444', marginBottom:4 }}>
            <AlertCircle size={15} /> 오류
          </div>
          <div style={{ fontSize:12, color:'#6B7280' }}>{error}</div>
          {error.includes('만료') && (
            <a href="https://graytag.co.kr/login" target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:8, fontSize:12, color:'#7C3AED', fontWeight:600 }}>
              graytag.co.kr 로그인 <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      {/* 로딩 */}
      {loading && <div style={{ display:'flex', flexDirection:'column', gap:10 }}>{[1,2,3].map(i => <div key={i} style={{ background:'#fff', borderRadius:16, height:80, opacity:0.5, animation:'pulse 1.5s infinite' }} />)}</div>}

      {data && !loading && (
        <>
          {/* ─── 세션 상태 배너 ───────────────────────── */}
          {sessionStatus && (
            <div style={{
              background: sessionStatus.isHealthy ? '#ECFDF5' : '#FFF0F0',
              borderRadius:14, padding:'12px 16px', marginBottom:14,
              borderLeft: `4px solid ${sessionStatus.isHealthy ? '#10B981' : '#EF4444'}`
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                {sessionStatus.isHealthy ? (
                  <Wifi size={16} color="#10B981" />
                ) : (
                  <WifiOff size={16} color="#EF4444" />
                )}
                <div style={{ flex:1, fontSize:12, fontWeight:600, color: sessionStatus.isHealthy ? '#059669' : '#991B1B' }}>
                  {sessionStatus.isHealthy ? '✅ 세션 정상' : '⚠️ 세션 경고'}
                  {sessionStatus.elapsedSinceSuccess !== undefined && (
                    <span style={{ fontSize:11, color: '#6B7280', marginLeft:8 }}>
                      (마지막 성공: {sessionStatus.elapsedSinceSuccess < 60 ? '방금 전' : `${Math.floor(sessionStatus.elapsedSinceSuccess / 60)}분 전`})
                    </span>
                  )}
                </div>
                <button onClick={() => { setSessionLoading(true); fetchSessionStatus().then(() => setSessionLoading(false)); }}
                  disabled={sessionLoading} style={{
                    background:'none', border:'none', cursor: sessionLoading ? 'not-allowed' : 'pointer', padding:4, opacity: sessionLoading ? 0.5 : 1
                  }}>
                  <RefreshCw size={14} color="#6B7280" style={{ animation: sessionLoading ? 'spin 1s linear infinite' : 'none' }} />
                </button>
              </div>
              {sessionStatus.detail && (
                <div style={{ fontSize:10, color:'#6B7280', marginTop:6, paddingLeft:24 }}>{sessionStatus.detail}</div>
              )}
            </div>
          )}

          {/* 요약 배너 */}
          <div style={{ background:'linear-gradient(135deg, #A78BFA 0%, #818CF8 100%)', borderRadius:20, padding:'16px 20px', marginBottom:14, color:'#fff' }}>
            <div style={{ fontSize:12, opacity:0.85, marginBottom:10 }}>전체 현황</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, textAlign:'center' }}>
              {[
                { label:'계정 수', value:`${actualTotalAccounts}개` },
                { label:'이용 중', value:`${sum!.totalUsingMembers + totalManualUsingCount}명` },
                { label:'현재 수입', value:fmtMoney(sum!.totalIncome) },
                { label:'정산 완료', value:fmtMoney(sum!.totalRealized) },
              ].map(item => (
                <div key={item.label} style={{ background:'rgba(255,255,255,0.15)', borderRadius:10, padding:'8px 4px' }}>
                  <div style={{ fontSize:13, fontWeight:700, lineHeight:1.2 }}>{item.value}</div>
                  <div style={{ fontSize:9, opacity:0.8, marginTop:3 }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 계정 생성 컴포넌트 */}
          <div style={{ background:'linear-gradient(135deg,#FFF7ED 0%,#FDF2F8 45%,#EEF2FF 100%)', border:'1.5px solid #FED7AA', borderRadius:20, padding:16, marginBottom:14, boxShadow:'0 8px 24px rgba(251,146,60,0.10)' }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10, marginBottom:12 }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:15, fontWeight:900, color:'#1E1B4B' }}><KeyRound size={16} color="#F97316" /> 계정 생성</div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4, lineHeight:1.35 }}>{accountCreateCopy.description}</div>
              </div>
              <span style={{ flexShrink:0, fontSize:10, fontWeight:900, color:'#C2410C', background:'#FFEDD5', borderRadius:999, padding:'4px 9px' }}>생성 전용</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
              <select value={accountCreateService} onChange={e => setAccountCreateService(e.target.value)} disabled={accountCreateLoading}
                style={{ border:'1.5px solid #FED7AA', borderRadius:12, padding:'10px 12px', fontFamily:'inherit', fontSize:13, fontWeight:800, color:'#1E1B4B', background:'#fff' }}>
                {[{ label:accountCreateCopy.serviceLabel, value:'티빙+웨이브' }, ...CATEGORIES.filter(cat => cat.label !== '티빙' && cat.label !== '웨이브').map(cat => ({ label: cat.label, value: cat.label }))].map(cat => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
              </select>
              <button onClick={handleCreateGeneratedAccount} disabled={accountCreateLoading}
                style={{ border:'none', borderRadius:12, padding:'10px 14px', background:accountCreateLoading?'#FDBA74':'#F97316', color:'#fff', fontSize:12, fontWeight:900, cursor:accountCreateLoading?'not-allowed':'pointer', display:'flex', alignItems:'center', gap:6 }}>
                {accountCreateLoading ? <Loader2 size={14} style={{ animation:'spin 1s linear infinite' }} /> : <PlusCircle size={14} />}
                {accountCreateLoading ? '생성중' : '새 계정 생성'}
              </button>
            </div>
            <div style={{ marginTop:8 }}>
              <label style={{ display:'block', fontSize:10, fontWeight:900, color:'#C2410C', marginBottom:4 }}>{accountCreateCopy.prefixLabel}</label>
              <input value={accountCreatePrefix} onChange={e => setAccountCreatePrefix(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} disabled={accountCreateLoading}
                placeholder={accountCreateCopy.prefixPlaceholder}
                style={{ width:'100%', boxSizing:'border-box', border:'1.5px solid #FED7AA', borderRadius:12, padding:'10px 12px', fontFamily:'inherit', fontSize:13, fontWeight:800, color:'#1E1B4B', background:'#fff' }} />
              <div style={{ fontSize:10, color:'#9CA3AF', marginTop:4 }}>{accountCreateCopy.prefixHelp}</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:6, marginTop:10 }}>
              {accountCreateCopy.featureLabels.map(label => <div key={label} style={{ background:'rgba(255,255,255,0.72)', borderRadius:10, padding:'7px 6px', fontSize:10, color:'#9A3412', fontWeight:800, textAlign:'center' }}>✓ {label}</div>)}
            </div>
            {accountCreateResult && <div style={{ marginTop:10, borderRadius:12, padding:'9px 10px', fontSize:12, fontWeight:800, background:accountCreateResult.startsWith('오류')?'#FFF0F0':'#ECFDF5', color:accountCreateResult.startsWith('오류')?'#EF4444':'#059669' }}>{accountCreateResult}</div>}
          </div>

          <ManualResponseQueuePanel />

          {/* 필터 */}
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {([
              { key:'using',  label:'이용 중' },
              { key:'active', label:'전체 활성' },
              { key:'all',    label:'전체 내역' },
            ] as { key: FilterMode; label: string }[]).map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{ flex:1, padding:'7px 4px', borderRadius:10, border:'none', fontFamily:'inherit', fontSize:11, fontWeight:600, cursor:'pointer', background: filter===f.key ? '#A78BFA' : '#F3F0FF', color: filter===f.key ? '#fff' : '#6B7280' }}>{f.label}</button>
            ))}
          </div>

          {/* 서비스별 */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {data.services.map(svc => {
              const sc = svcColors(svc.serviceType);
              const logo = svcLogo(svc.serviceType);
              const isOpen = openService === svc.serviceType;
              const serviceVerifyingCount = svc.accounts.reduce((sum, acct) => sum + acct.members.filter(isAccountCheckingMember).length, 0);
              const serviceUsingWithManual = svc.totalUsingMembers + serviceManualUsingCount(svc);
              const actualPartyAccountCount = svc.accounts.filter((acct) => (
                acct.email !== '(직접전달)' &&
                (acct.usingCount > 0 || getManualForAccount(acct.email, acct.serviceType).some((m) => m.status === 'active') || acct.generatedAccount?.paymentStatus === 'paid')
              )).length;
              return (
                <div key={svc.serviceType} style={{ background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:`1.5px solid ${isOpen?'#A78BFA':'#F3F0FF'}` }}>
                  <button onClick={() => setOpenService(isOpen ? null : svc.serviceType)} style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                    <div style={{ width:40, height:40, borderRadius:12, background:sc.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {logo ? <img src={logo} alt={svc.serviceType} style={{ width:26, height:26, objectFit:'contain' }} onError={e=>{(e.target as HTMLImageElement).style.display='none';}} /> : null}
                    </div>
                    <div style={{ flex:1, textAlign:'left' }}>
                      <div style={{ fontSize:15, fontWeight:700, color:'#1E1B4B' }}>{svc.serviceType}</div>
                      <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>계정 {actualPartyAccountCount}개 · 이용중 {serviceUsingWithManual}명{serviceManualUsingCount(svc) > 0 ? ` (수동 포함 +${serviceManualUsingCount(svc)})` : ''}{serviceVerifyingCount > 0 ? ` · 확인중 ${serviceVerifyingCount}명` : ''}</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'#A78BFA' }}>{fmtMoney(svc.totalIncome)}</div>
                      <div style={{ fontSize:10, color:'#059669', marginTop:1 }}>정산 {fmtMoney(svc.totalRealized)}</div>
                    </div>
                    {isOpen ? <ChevronDown size={16} color="#A78BFA" /> : <ChevronRight size={16} color="#A78BFA" />}
                  </button>

                  {isOpen && (
                    <div style={{ borderTop:'1px solid #F3F0FF', padding:'8px 12px 12px' }}>
                      {svc.accounts.filter(a => a.email !== '(직접전달)').map(acct => {
                        const acctKey = `${acct.email}__${acct.serviceType}`;
                        const isAcctOpen = openAccount === acctKey;
                        const filteredMembers = acct.members.filter(m => {
                          if (filter==='using') return USING_SET.has(m.status) || isAccountCheckingMember(m);
                          if (filter==='active') return ACTIVE_SET.has(m.status);
                          return true;
                        });
                        const hasOnSale = (data?.onSaleByKeepAcct?.[acct.email]?.length ?? 0) > 0;
                        const manualForAccount = getManualForAccount(acct.email, acct.serviceType);
                        const visiblePartyRefs = [
                          ...filteredMembers.map(m => `graytag:${m.dealUsid}`),
                          ...manualForAccount.map(mm => `manual:${mm.id}`),
                        ];
                        const partyProfileNicknames = generateUniqueProfileNicknames(visiblePartyRefs.length, '', stableRandomFromSeed(`${acct.serviceType}:${acct.email}:party-profiles`));
                        const profileNicknameByMember = new Map(visiblePartyRefs.map((key, i) => [key, partyProfileNicknames[i] || generateProfileNickname(stableRandomFromSeed(`${acct.serviceType}:${acct.email}:${key}`))]));
                        const profileNameForMember = (kind: 'graytag' | 'manual', id: string) => profileNicknameByMember.get(`${kind}:${id}`) || generateProfileNickname(stableRandomFromSeed(`${acct.serviceType}:${acct.email}:${kind}:${id}`));
                        const vi = getVacancyInfo(acct);
                        if (filter === 'using' && acct.usingCount === 0 && vi.manualCount === 0 && !acct.generatedAccount) return null;
                        if (filter === 'active' && acct.usingCount === 0 && acct.activeCount === 0 && vi.manualCount === 0 && !hasOnSale && !acct.generatedAccount) return null;
                        if (filter !== 'all' && acct.usingCount===0 && acct.activeCount===0 && vi.manualCount === 0 && !hasOnSale && !acct.generatedAccount) return null;
                        const filledSlots = acct.usingCount + vi.manualCount;
                        const totalSlots = getPartyMax(acct.serviceType);
                        const fillPct = Math.round((filledSlots/totalSlots)*100);
                        const isGeneratedPending = acct.generatedAccount?.paymentStatus === 'pending';
                        const fillActionLabel = acct.generatedAccount
                          ? (isGeneratedPending ? '결제/가입 Y 후 게시글 작성 가능' : `${vi.unfilled}자리 게시글 작성`)
                          : `${vi.unfilled}자리 메꾸기`;
                        const partyInfo = calcPartyDuration(acct.members);
                        const verifyingCount = acct.members.filter(isAccountCheckingMember).length;
                        const emailAliasId = findEmailAliasId(acct);
                        const credential = findMaintenanceCredentialForAccount(acct);
                        const credentialKey = accountCredentialKey(acct);
                        const existingPinRecord = findExistingPinRecordForAccount(acct);
                        const exitChecklist = maintenanceChecklistStore[credentialKey];
                        const credentialRows = [
                          { label: 'ID', value: acct.email },
                          { label: 'PW', value: credential?.password || acct.keepPasswd || '' },
                          { label: 'PIN', value: credential?.pin || '' },
                        ];
                        const currentPasswordDraft = passwordDrafts[credentialKey] ?? credentialRows[1].value;
                        const slotStates = buildAccountSlotStates({
                          totalSlots,
                          usingCount: acct.usingCount,
                          verifyingCount,
                          manualCount: vi.manualCount,
                          recruitingCount: vi.recruiting,
                          activeCount: acct.activeCount,
                        });
                        return (
                          <div key={acctKey} style={{ marginBottom:8, background:'#F8F6FF', borderRadius:12, overflow:'hidden' }}>
                            <button onClick={() => {
                              setOpenAccount(isAcctOpen ? null : acctKey);
                              if (!isAcctOpen) void loadExistingPinForAccount(acct);
                            }} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 14px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                              {/* 슬롯 게이지 */}
                              <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:3, minWidth:36 }}>
                                <div style={{ display:'flex', gap:3 }}>
                                  {slotStates.map((state: SlotState, i) => {
                                    const filled = state !== 'empty';
                                    const background = state === 'using' ? '#A78BFA'
                                      : state === 'verifying' ? '#2563EB'
                                      : state === 'manual' ? '#10B981'
                                      : state === 'recruiting' ? '#D1D5DB'
                                      : state === 'active' ? '#C4B5FD'
                                      : '#E9E4FF';
                                    const title = state === 'using' ? '이용중'
                                      : state === 'verifying' ? '계정 확인중(파란색 추적)'
                                      : state === 'manual' ? '수동파티원'
                                      : state === 'recruiting' ? '모집 게시글 등록됨'
                                      : state === 'active' ? '활성'
                                      : '비어있음';
                                    return (
                                      <div key={i} title={title} style={{ width: filled?7:6, height: filled?18:14, borderRadius:3,
                                        background,
                                        alignSelf:'flex-end' }} />
                                    );
                                  })}
                                </div>
                                <div style={{ fontSize:9, color:'#9CA3AF' }}>{acct.usingCount + vi.manualCount}/{totalSlots}</div>
                                {verifyingCount > 0 && <div style={{ fontSize:8, color:'#2563EB', fontWeight:900, whiteSpace:'nowrap' }}>확인중 {verifyingCount}</div>}
                                <span
                                  role="button"
                                  tabIndex={emailAliasId ? 0 : -1}
                                  onClick={(e) => { e.stopPropagation(); openEmailDashboardForAccount(acct); }}
                                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && emailAliasId) { e.preventDefault(); e.stopPropagation(); openEmailDashboardForAccount(acct); } }}
                                  title={emailAliasId ? '이메일 대시보드 새 탭 열기' : '연결된 이메일 대시보드 alias를 찾지 못했어요'}
                                  aria-disabled={!emailAliasId}
                                  style={{ marginTop:2, border:'none', borderRadius:7, padding:'2px 5px', background:emailAliasId?'#EEF2FF':'#F3F4F6', color:emailAliasId?'#4F46E5':'#D1D5DB', fontSize:8, fontWeight:900, cursor:emailAliasId?'pointer':'not-allowed', fontFamily:'inherit', lineHeight:1.2, whiteSpace:'nowrap' }}>
                                  이메일
                                </span>
                              </div>
                              <div style={{ flex:1, textAlign:'left', minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                  <Mail size={12} color="#9CA3AF" />
                                  <span style={{ fontSize:12, fontWeight:700, color:'#1E1B4B', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acct.email}</span>
                                </div>
                                <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:3, flexWrap:'wrap' }}>
                                  {acct.generatedAccount && <span style={{ fontSize:10, color:acct.generatedAccount.paymentStatus==='paid'?'#059669':'#C2410C', fontWeight:900, display:'flex', alignItems:'center', gap:3, background:acct.generatedAccount.paymentStatus==='paid'?'#ECFDF5':'#FFEDD5', borderRadius:6, padding:'1px 7px' }}>
                                    <KeyRound size={10} /> {acct.generatedAccount.paymentStatus==='paid'?'결제 완료':'생성만 완료'}
                                  </span>}
                                  {vi.vacancy === 0 && <span style={{ fontSize:10, color:'#059669', fontWeight:600, display:'flex', alignItems:'center', gap:3 }}><TrendingUp size={10} /> 만석</span>}
                                  {vi.vacancy > 0 && vi.unfilled > 0 && (
                                    <span style={{ fontSize:10, color:'#EF4444', fontWeight:700, display:'flex', alignItems:'center', gap:3, background:'#FFF0F0', borderRadius:6, padding:'1px 7px' }}>
                                      <UserX size={10} /> 빈자리 {vi.unfilled}
                                    </span>
                                  )}
                                  {vi.vacancy > 0 && vi.unfilled === 0 && vi.recruiting > 0 && (
                                    <span style={{ fontSize:10, color:'#059669', fontWeight:700, display:'flex', alignItems:'center', gap:3, background:'#ECFDF5', borderRadius:6, padding:'1px 7px' }}>
                                      <Megaphone size={10} /> 모집 진행중 {vi.recruiting}건
                                    </span>
                                  )}
                                  {vi.vacancy > 0 && vi.unfilled > 0 && vi.recruiting > 0 && (
                                    <span style={{ fontSize:10, color:'#D97706', fontWeight:600, display:'flex', alignItems:'center', gap:3, background:'#FFFBEB', borderRadius:6, padding:'1px 7px' }}>
                                      <Megaphone size={10} /> 모집중 {vi.recruiting}건
                                    </span>
                                  )}
                                  {/* 모집중 게시글 링크 + 삭제 */}
                                  {vi.recruiting > 0 && vi.onSaleList.map(p => (
                                    <span key={p.productUsid} style={{ display:'inline-flex', alignItems:'center', gap:2 }}>
                                      <a href={`https://graytag.co.kr/product/detail?productUsid=${p.productUsid}`}
                                        target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                        style={{ fontSize:9, color:'#7C3AED', textDecoration:'underline', display:'inline-flex', alignItems:'center', gap:2 }}>
                                        <ExternalLink size={8} />{p.price}
                                      </a>
                                      <button onClick={async (e) => {
                                        e.stopPropagation();
                                        if (!window.confirm(`이 모집 게시글(${p.price})을 삭제하시겠습니까?`)) return;
                                        try {
                                          const cs = cookies.find(c => c.id === selectedId);
                                          const body = cs?.id === AUTO_COOKIE_ID ? { usids: [p.productUsid] } : { AWSALB: cs?.AWSALB, AWSALBCORS: cs?.AWSALBCORS, JSESSIONID: cs?.JSESSIONID, usids: [p.productUsid] };
                                          const res = await fetch('/api/my/delete-products', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
                                          const json = await res.json() as any;
                                          if (json.successCount && json.successCount > 0) {
                                            setData(prev => prev ? removeRecruitingProductFromManageData(prev, acct.email, p.productUsid) as ManageData : prev);
                                            // 서버 반영을 기다리지 않고 즉시 UI에서 제거하고, 백그라운드로 최신 상태를 맞춘다.
                                            void doFetch(undefined, true);
                                          } else {
                                            const errMsg = json.results?.[0]?.error || json.error || '알 수 없는 오류';
                                            alert('삭제 실패:\n' + errMsg);
                                          }
                                        } catch (err: any) { alert('삭제 오류:\n' + err.message); }
                                      }} style={{ background:'none', border:'none', cursor:'pointer', padding:'1px 2px', display:'inline-flex', alignItems:'center', flexShrink:0 }} title="게시글 삭제">
                                        <X size={10} color="#EF4444" />
                                      </button>
                                    </span>
                                  ))}
                                  <span style={{ fontSize:10, color:'#9CA3AF' }}>{fillPct}% 사용</span>
                                  {acct.expiryDate && <span style={{ fontSize:10, color:'#9CA3AF' }}>~{fmtDate(acct.expiryDate)}</span>}
                                </div>
                                {/* 파티 기간 표시 */}
                                {partyInfo.startDate && (
                                  <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:3 }}>
                                    <Calendar size={10} color="#C4B5FD" />
                                    <span style={{ fontSize:10, color:'#A78BFA', fontWeight:600 }}>
                                      {fmtDate(partyInfo.startDate)} ~ {fmtDate(partyInfo.endDate)}
                                      {partyInfo.totalDays > 0 && ` (${partyInfo.totalDays}일)`}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div style={{ textAlign:'right', flexShrink:0 }}>
                                <div style={{ fontSize:13, fontWeight:700, color:'#A78BFA' }}>{fmtMoney(acct.totalIncome)}</div>
                                {acct.totalRealizedIncome > 0 && <div style={{ fontSize:10, color:'#059669', marginTop:1 }}>정산 {fmtMoney(acct.totalRealizedIncome)}</div>}
                              </div>
                              {isAcctOpen ? <ChevronDown size={13} color="#C4B5FD" /> : <ChevronRight size={13} color="#C4B5FD" />}
                            </button>

                            {isAcctOpen && (
                              <div style={{ borderTop:'1px solid #EDE9FE', padding:'8px 14px' }}>

                                <div style={{ background:'#FFFFFF', border:'1.5px solid #EDE9FE', borderRadius:14, padding:12, marginBottom:10 }}>
                                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                                    <div>
                                      <div style={{ fontSize:13, fontWeight:900, color:'#1E1B4B' }}>관리자 전용 ID · PW · PIN</div>
                                      <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>계정 클릭 시에만 표시 · 복붙용</div>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); handleRegeneratePin(acct); }} disabled={pinResetLoadingKey === credentialKey}
                                      style={{ border:'none', borderRadius:999, padding:'7px 10px', background:pinResetLoadingKey === credentialKey ? '#C4B5FD' : '#7C3AED', color:'#fff', fontSize:11, fontWeight:900, cursor:pinResetLoadingKey === credentialKey ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', gap:5 }}>
                                      {pinResetLoadingKey === credentialKey ? <Loader2 size={12} style={{ animation:'spin 1s linear infinite' }} /> : <KeyRound size={12} />}
                                      PIN 번호 재설정
                                    </button>
                                  </div>
                                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7 }}>
                                    {credentialRows.map(row => (
                                      <div key={row.label} style={{ background:'#F8F6FF', borderRadius:10, padding:'8px 9px', minWidth:0 }}>
                                        <div style={{ display:'flex', justifyContent:'space-between', gap:4, alignItems:'center' }}>
                                          <span style={{ fontSize:9, color:'#9CA3AF', fontWeight:900 }}>{row.label}</span>
                                          <button onClick={(e) => { e.stopPropagation(); copyText(row.value); }} disabled={!row.value} style={{ border:'none', background:'transparent', color:row.value?'#7C3AED':'#D1D5DB', fontSize:9, fontWeight:900, cursor:row.value?'pointer':'not-allowed' }}>복사</button>
                                        </div>
                                        <div style={{ fontSize:11, color:'#1E1B4B', fontWeight:900, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{row.value || '-'}</div>
                                      </div>
                                    ))}
                                  </div>
                                  {existingPinRecord?.loading && (
                                    <div style={{ marginTop:8, background:'#EEF2FF', border:'1px solid #C7D2FE', borderRadius:10, padding:'7px 9px', fontSize:10, color:'#4338CA', fontWeight:900, display:'flex', alignItems:'center', gap:6 }}>
                                      <Loader2 size={11} style={{ animation:'spin 1s linear infinite' }} /> 기존 PIN 로딩중
                                    </div>
                                  )}
                                  {existingPinRecord?.checked && existingPinRecord.pin && !exitChecklist?.generatedPin && !acct.generatedAccount?.pin && (
                                    <div style={{ marginTop:8, background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:10, padding:'7px 9px', fontSize:10, color:'#047857', fontWeight:900 }}>
                                      기존 PIN 로드 완료 · Email #{existingPinRecord.emailId || '-'}
                                    </div>
                                  )}
                                  {existingPinRecord?.checked && !existingPinRecord.pin && (
                                    <div style={{ marginTop:8, background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, padding:'7px 9px', fontSize:10, color:'#92400E', fontWeight:900 }}>
                                      {existingPinRecord.message || '기존 PIN 없음'}
                                    </div>
                                  )}
                                  <div style={{ marginTop:9, background:'#F8F6FF', borderRadius:12, padding:9, display:'grid', gridTemplateColumns:'1fr auto', gap:7, alignItems:'center' }}>
                                    <input value={currentPasswordDraft} onChange={(e) => setPasswordDrafts(prev => ({ ...prev, [credentialKey]: e.target.value }))} placeholder="최신 비밀번호 입력" style={{ border:'1px solid #EDE9FE', borderRadius:10, padding:'8px 10px', fontSize:11, fontWeight:800, color:'#1E1B4B', fontFamily:'inherit', minWidth:0 }} />
                                    <button onClick={(e) => { e.stopPropagation(); handleSaveLatestPassword(acct); }} disabled={passwordSaveLoadingKey === credentialKey} style={{ border:'none', borderRadius:999, padding:'8px 10px', background:passwordSaveLoadingKey === credentialKey ? '#C4B5FD' : '#10B981', color:'#fff', fontSize:10, fontWeight:900, cursor:passwordSaveLoadingKey === credentialKey ? 'not-allowed' : 'pointer' }}>
                                      {passwordSaveLoadingKey === credentialKey ? '저장중' : '최신 비밀번호 저장'}
                                    </button>
                                  </div>
                                  {pinResetNoticeKey === credentialKey && (
                                    <div style={{ marginTop:9, background:'#FFF7ED', border:'1.5px solid #FED7AA', borderRadius:12, padding:'9px 10px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                      <div style={{ fontSize:11, color:'#9A3412', fontWeight:900 }}>변경된 핀번호를 다른 사람들에게 전달했나요?</div>
                                      <div style={{ display:'flex', gap:5 }}>
                                        <button onClick={(e) => { e.stopPropagation(); setPinResetNoticeKey(null); }} style={{ border:'none', borderRadius:999, padding:'5px 9px', background:'#10B981', color:'#fff', fontSize:10, fontWeight:900, cursor:'pointer' }}>네</button>
                                        <button onClick={(e) => e.stopPropagation()} style={{ border:'none', borderRadius:999, padding:'5px 9px', background:'#FED7AA', color:'#9A3412', fontSize:10, fontWeight:900, cursor:'default' }}>아니오</button>
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <div style={{ background:'#FFFFFF', border:'1.5px solid #EDE9FE', borderRadius:14, padding:12, marginBottom:10 }}>
                                  <div style={{ fontSize:13, fontWeight:900, color:'#1E1B4B', marginBottom:7 }}>퇴장 정리 체크리스트</div>
                                  <div style={{ fontSize:10, color:'#9CA3AF', marginBottom:8 }}>파티원이 나갔을 때 프로필/기기/PW/PIN/공지 상태를 계정별로 표시해요.</div>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                                    {([
                                      ['프로필 삭제', 'profileRemoved', true],
                                      ['기기 로그아웃', 'devicesLoggedOut', true],
                                      ['PW 변경', 'passwordChanged', true],
                                      ['PIN 변경', 'pinStillUnchanged', false],
                                      ['남은 파티원 공지', 'noticeSent', true],
                                    ] as const).map(([label, field, doneValue]) => {
                                      const done = (exitChecklist as any)?.[field] === doneValue;
                                      return <button key={field} onClick={(e) => { e.stopPropagation(); updateAccountExitChecklist(acct, { [field]: doneValue }); }} style={{ border:'none', borderRadius:999, padding:'6px 9px', background:done?'#ECFDF5':'#F3F4F6', color:done?'#059669':'#6B7280', fontSize:10, fontWeight:900, cursor:'pointer' }}>{done ? '✓ ' : ''}{label}</button>;
                                    })}
                                  </div>
                                </div>

                                {acct.generatedAccount && (
                                  <div style={{ background:acct.generatedAccount.paymentStatus==='paid'?'#ECFDF5':'#FFF7ED', border:`1.5px solid ${acct.generatedAccount.paymentStatus==='paid'?'#A7F3D0':'#FED7AA'}`, borderRadius:14, padding:12, marginBottom:10 }}>
                                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:8 }}>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:900, color:'#1E1B4B' }}>✨ 방금 생성한 계정</div>
                                        <div style={{ fontSize:10, color:'#9CA3AF', marginTop:2 }}>판매 게시물 없이도 계정 관리에 유지돼요 · Email ID #{acct.generatedAccount.emailId}</div>
                                      </div>
                                      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                                        <div onClick={e => e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:4, background:'#fff', borderRadius:999, padding:'4px 6px' }}>
                                          <span style={{ fontSize:10, fontWeight:900, color:'#6B7280', marginRight:2 }}>결제/가입 완료</span>
                                          {([['Y', true], ['N', false]] as const).map(([label, paid]) => (
                                            <button key={label} onClick={() => toggleGeneratedAccountPaid(acct, paid)} style={{ border:'none', borderRadius:999, padding:'4px 8px', fontSize:10, fontWeight:900, cursor:'pointer', fontFamily:'inherit', background:(acct.generatedAccount!.paymentStatus === 'paid') === paid ? (paid ? '#10B981' : '#F97316') : '#F3F4F6', color:(acct.generatedAccount!.paymentStatus === 'paid') === paid ? '#fff' : '#9CA3AF' }}>{label}</button>
                                          ))}
                                        </div>
                                        <button onClick={e => { e.stopPropagation(); handleDeleteGeneratedAccount(acct); }} title="방금 생성한 계정 삭제" style={{ border:'none', background:'#FFF0F0', color:'#EF4444', borderRadius:999, padding:'6px 9px', fontSize:11, fontWeight:900, cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                                          <Trash2 size={12} /> 삭제
                                        </button>
                                      </div>
                                    </div>
                                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                                      <div style={{ background:'#fff', borderRadius:10, padding:'8px 9px' }}><div style={{ fontSize:9, color:'#9CA3AF', fontWeight:800 }}>ID</div><div style={{ fontSize:12, color:'#1E1B4B', fontWeight:900, marginTop:2, wordBreak:'break-all' }}>{acct.generatedAccount.id}</div></div>
                                      <div style={{ background:'#fff', borderRadius:10, padding:'8px 9px' }}><div style={{ fontSize:9, color:'#9CA3AF', fontWeight:800 }}>비밀번호</div><div style={{ fontSize:12, color:'#1E1B4B', fontWeight:900, marginTop:2 }}>{acct.keepPasswd || '-'}</div></div>
                                      <div style={{ background:'#fff', borderRadius:10, padding:'8px 9px' }}><div style={{ fontSize:9, color:'#9CA3AF', fontWeight:800 }}>PIN</div><div style={{ fontSize:12, color:'#1E1B4B', fontWeight:900, marginTop:2 }}>{acct.generatedAccount.pin}</div></div>
                                      <div style={{ background:'#fff', borderRadius:10, padding:'8px 9px' }}><div style={{ fontSize:9, color:'#9CA3AF', fontWeight:800 }}>상태</div><div style={{ fontSize:12, color:acct.generatedAccount.paymentStatus==='paid'?'#059669':'#C2410C', fontWeight:900, marginTop:2 }}>{acct.generatedAccount.paymentStatus==='paid'?'결제/가입 완료':'결제/가입 대기'}</div></div>
                                    </div>
                                    {isGeneratedPending && <div style={{ fontSize:10, color:'#C2410C', marginTop:8, lineHeight:1.35 }}>다음 단계: 이 계정으로 티빙·웨이브 가입/결제 → Y 표시 → 아래 생성계정 게시글 작성으로 바로 모집글을 올리세요.</div>}
                                  </div>
                                )}

                                {filteredMembers.length === 0 ? (
                                  <div style={{ fontSize:12, color:'#9CA3AF', textAlign:'center', padding:'8px 0' }}>해당 조건의 파티원 없음</div>
                                ) : filteredMembers.map((m, idx) => {
                                  const b = bge(m.status, m.statusName);
                                  const isVerifying = isAccountCheckingMember(m);
                                  const isUsing = USING_SET.has(m.status);
                                  const memberAccessKey = `${acct.serviceType}:${acct.email}:graytag:${m.dealUsid}:url`;
                                  const memberTemplateKey = `${acct.serviceType}:${acct.email}:graytag:${m.dealUsid}:template`;
                                  const assignedProfileName = profileNameForMember('graytag', m.dealUsid);
                                  const circleBg = isVerifying ? '#2563EB' : isUsing ? '#A78BFA' : ACTIVE_SET.has(m.status) ? '#C4B5FD' : '#E9E4FF';
                                  const circleColor = (isVerifying || isUsing || ACTIVE_SET.has(m.status)) ? '#fff' : '#9CA3AF';
                                  return (
                                    <div key={m.dealUsid} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 0', borderBottom: idx<filteredMembers.length-1 ? '1px solid #F3F0FF' : 'none' }}>
                                      <div style={{ width:26, height:26, borderRadius:8, flexShrink:0, background: circleBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, marginTop:2, color: circleColor }}>{idx+1}</div>
                                      <div style={{ flex:1, minWidth:0 }}>
                                        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                          <span style={{ fontSize:13, fontWeight:700, color:'#1E1B4B' }}>{m.name||'(미확인)'}</span>
                                          <span style={{ fontSize:10, fontWeight:600, color:b.color, background:b.bg, borderRadius:6, padding:'2px 7px' }}>{b.label}</span>
                                        </div>
                                        {(m.startDateTime||m.endDateTime) && <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{m.startDateTime&&fmtDate(m.startDateTime)}{m.startDateTime&&m.endDateTime&&' ~ '}{m.endDateTime&&fmtDate(m.endDateTime)}{m.remainderDays>0&&` (${m.remainderDays}일)`}</div>}
                                        <div style={{ fontSize:10, color:'#4F46E5', fontWeight:900, marginTop:3 }}>배정 프로필: {assignedProfileName}</div>
                                        <div style={{ marginTop:5, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                                          <button onClick={(e) => { e.stopPropagation(); createPartyAccessLink(acct, { kind:'graytag', memberId:m.dealUsid, memberName:m.name || '(미확인)', profileName:assignedProfileName, status:m.status, statusName:m.statusName, startDateTime:m.startDateTime, endDateTime:m.endDateTime }); }} disabled={accessLinkLoadingKey === memberAccessKey} style={{ border:'none', borderRadius:999, background:accessLinkLoadingKey === memberAccessKey ? '#C4B5FD' : '#EEF2FF', color:'#4F46E5', padding:'4px 8px', fontSize:9, fontWeight:900, cursor:accessLinkLoadingKey === memberAccessKey ? 'not-allowed' : 'pointer' }}>
                                            {accessLinkLoadingKey === memberAccessKey ? '생성중' : '접근 링크 만들기'}
                                          </button>
                                          <button onClick={(e) => { e.stopPropagation(); createPartyAccessLink(acct, { kind:'graytag', memberId:m.dealUsid, memberName:m.name || '(미확인)', profileName:assignedProfileName, status:m.status, statusName:m.statusName, startDateTime:m.startDateTime, endDateTime:m.endDateTime }, 'template'); }} disabled={accessLinkLoadingKey === memberTemplateKey} style={{ border:'none', borderRadius:999, background:accessLinkLoadingKey === memberTemplateKey ? '#C4B5FD' : '#F5F3FF', color:'#7C3AED', padding:'4px 8px', fontSize:9, fontWeight:900, cursor:accessLinkLoadingKey === memberTemplateKey ? 'not-allowed' : 'pointer' }}>
                                            {accessLinkLoadingKey === memberTemplateKey ? '복사중' : '수동 전달 템플릿 복사'}
                                          </button>
                                          {accessLinkResult?.key === memberAccessKey && <span style={{ fontSize:9, color:'#059669', fontWeight:900 }}>파티원 전용 계정정보 링크 복사됨</span>}
                                          {accessLinkResult?.key === memberTemplateKey && <span style={{ fontSize:9, color:'#059669', fontWeight:900 }}>수동 전달 템플릿 복사됨</span>}
                                        </div>
                                        {isUsing && m.progressRatio && m.progressRatio!=='0%' && (
                                          <div style={{ marginTop:5 }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#9CA3AF', marginBottom:2 }}><span>진행률</span><span>{m.progressRatio}</span></div>
                                            <div style={{ background:'#E9E4FF', borderRadius:4, height:4 }}><div style={{ background:'#A78BFA', borderRadius:4, height:'100%', width:m.progressRatio, maxWidth:'100%' }} /></div>
                                          </div>
                                        )}
                                      </div>
                                      <div style={{ textAlign:'right', flexShrink:0 }}>
                                        <div style={{ fontSize:13, fontWeight:700, color:'#A78BFA' }}>{m.price}</div>
                                        {m.purePrice > 0 && m.startDateTime && m.endDateTime && (() => {
                                          const s = new Date(m.startDateTime!.replace(/\s/g,'').replace(/\./g,'-').replace(/-$/,'').split('-').map((p,i) => i===0 && parseInt(p)<100 ? String(parseInt(p)+2000) : p).join('-'));
                                          const e = new Date(m.endDateTime!.replace(/\s/g,'').replace(/\./g,'-').replace(/-$/,'').split('-').map((p,i) => i===0 && parseInt(p)<100 ? String(parseInt(p)+2000) : p).join('-'));
                                          const days = Math.max(1, Math.ceil((e.getTime()-s.getTime())/86400000));
                                          const daily = Math.ceil(m.purePrice/days);
                                          return <div style={{ fontSize:10, color:'#9CA3AF', marginTop:1 }}>{daily.toLocaleString()}원/일</div>;
                                        })()}
                                        {m.realizedSum>0 && <div style={{ fontSize:10, color:'#059669', marginTop:2 }}>정산 {m.realizedSum.toLocaleString()}원</div>}
                                      </div>
                                    </div>
                                  );
                                })}
                                {/* ─── 수동 파티원 목록 ────────────────────── */}
                                {(() => {
                                  const manuals = manualForAccount;
                                  if (manuals.length === 0 && filter === 'using') return null;
                                  return (
                                    <>
                                      {manuals.length > 0 && (
                                        <div style={{ marginTop:8, marginBottom:4 }}>
                                          <div style={{ fontSize:10, fontWeight:700, color:'#A78BFA', marginBottom:6, display:'flex', alignItems:'center', gap:4 }}>
                                            <UserPlus size={10} /> 수동 추가 파티원 ({manuals.length}명)
                                          </div>
                                          {manuals.map((mm) => {
                                            const s = new Date(mm.startDate);
                                            const e = new Date(mm.endDate);
                                            const days = Math.max(1, Math.ceil((e.getTime()-s.getTime())/86400000));
                                            const daily = Math.ceil(mm.price / days);
                                            const now = new Date(); now.setHours(0,0,0,0);
                                            const remainDays = Math.max(0, Math.ceil((e.getTime()-now.getTime())/86400000));
                                            const isExpired = mm.status === 'expired' || remainDays <= 0;
                                            const manualAccessKey = `${acct.serviceType}:${acct.email}:manual:${mm.id}:url`;
                                            const manualTemplateKey = `${acct.serviceType}:${acct.email}:manual:${mm.id}:template`;
                                            const assignedProfileName = profileNameForMember('manual', mm.id);
                                            return (
                                              <div key={mm.id} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'9px 0', borderBottom:'1px solid #F3F0FF', opacity: isExpired?0.5:1 }}>
                                                <div style={{ width:26, height:26, borderRadius:8, flexShrink:0, background: isExpired?'#E9E4FF':'#10B981', display:'flex', alignItems:'center', justifyContent:'center', marginTop:2 }}>
                                                  <UserPlus size={12} color="#fff" />
                                                </div>
                                                <div style={{ flex:1, minWidth:0 }}>
                                                  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                                    <span style={{ fontSize:13, fontWeight:700, color:'#1E1B4B' }}>{mm.memberName}</span>
                                                    <span style={{ fontSize:10, fontWeight:600, color: isExpired?'#9CA3AF':'#10B981', background: isExpired?'#F3F4F6':'#ECFDF5', borderRadius:6, padding:'2px 7px' }}>
                                                      {isExpired ? '만료' : '수동'}
                                                    </span>
                                                    {mm.source && (
                                                      <span style={{ fontSize:9, fontWeight:600, color:'#7C3AED', background:'#EDE9FE', borderRadius:6, padding:'2px 7px' }}>
                                                        {mm.source}
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>
                                                    {mm.startDate.replace(/-/g,'/')} ~ {mm.endDate.replace(/-/g,'/')}
                                                    {!isExpired && remainDays > 0 && ` (${remainDays}일 남음)`}
                                                  </div>
                                                  <div style={{ fontSize:10, color:'#059669', fontWeight:900, marginTop:3 }}>배정 프로필: {assignedProfileName}</div>
                                                  <div style={{ marginTop:5, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                                                    <button onClick={(ev) => { ev.stopPropagation(); createPartyAccessLink(acct, { kind:'manual', memberId:mm.id, memberName:mm.memberName, profileName:assignedProfileName, status:mm.status, statusName:mm.status, startDateTime:mm.startDate, endDateTime:mm.endDate }); }} disabled={accessLinkLoadingKey === manualAccessKey || isExpired} style={{ border:'none', borderRadius:999, background:(accessLinkLoadingKey === manualAccessKey || isExpired) ? '#F3F4F6' : '#EEF2FF', color:isExpired ? '#9CA3AF' : '#4F46E5', padding:'4px 8px', fontSize:9, fontWeight:900, cursor:(accessLinkLoadingKey === manualAccessKey || isExpired) ? 'not-allowed' : 'pointer' }}>
                                                      {accessLinkLoadingKey === manualAccessKey ? '생성중' : '접근 링크 만들기'}
                                                    </button>
                                                    <button onClick={(ev) => { ev.stopPropagation(); createPartyAccessLink(acct, { kind:'manual', memberId:mm.id, memberName:mm.memberName, profileName:assignedProfileName, status:mm.status, statusName:mm.status, startDateTime:mm.startDate, endDateTime:mm.endDate }, 'template'); }} disabled={accessLinkLoadingKey === manualTemplateKey || isExpired} style={{ border:'none', borderRadius:999, background:(accessLinkLoadingKey === manualTemplateKey || isExpired) ? '#F3F4F6' : '#ECFDF5', color:isExpired ? '#9CA3AF' : '#059669', padding:'4px 8px', fontSize:9, fontWeight:900, cursor:(accessLinkLoadingKey === manualTemplateKey || isExpired) ? 'not-allowed' : 'pointer' }}>
                                                      {accessLinkLoadingKey === manualTemplateKey ? '복사중' : '수동 전달 템플릿 복사'}
                                                    </button>
                                                    {accessLinkResult?.key === manualAccessKey && <span style={{ fontSize:9, color:'#059669', fontWeight:900 }}>파티원 전용 계정정보 링크 복사됨</span>}
                                                    {accessLinkResult?.key === manualTemplateKey && <span style={{ fontSize:9, color:'#059669', fontWeight:900 }}>수동 전달 템플릿 복사됨</span>}
                                                  </div>
                                                  {mm.memo && <div style={{ fontSize:10, color:'#C4B5FD', marginTop:2 }}>{mm.memo}</div>}
                                                </div>
                                                <div style={{ textAlign:'right', flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                                                  <div style={{ fontSize:13, fontWeight:700, color:'#10B981' }}>{mm.price.toLocaleString()}원</div>
                                                  <div style={{ fontSize:10, color:'#9CA3AF' }}>{daily.toLocaleString()}원/일</div>
                                                  <button onClick={(ev) => { ev.stopPropagation(); handleDeleteManual(mm.id); }} style={{ background:'none', border:'none', cursor:'pointer', padding:2, marginTop:2 }}>
                                                    <Trash2 size={12} color="#EF4444" />
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}

                                {/* 수동 파티원 추가 버튼 */}
                                <button onClick={(e) => {
                                  e.stopPropagation();
                                  setAddManualModal({ serviceType: acct.serviceType, accountEmail: acct.email });
                                  setMmName(''); setMmStartDate(''); setMmEndDate(''); setMmPrice('');
                                  setMmSource(''); setMmSourceCustom(''); setMmMemo(''); setMmResult(null);
                                }} style={{
                                  width:'100%', marginTop:6, padding:'9px 14px', borderRadius:10,
                                  background:'#ECFDF5', border:'1.5px solid #6EE7B7',
                                  display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                                  cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, color:'#059669',
                                }}>
                                  <UserPlus size={14} /> 수동 파티원 추가
                                </button>

                                {/* 메꾸기 버튼 — 빈자리 있고 모집 게시물 부족할 때 */}
                                {vi.unfilled > 0 && (
                                  <button disabled={isGeneratedPending} title={isGeneratedPending ? '티빙·웨이브 가입/결제 후 Y를 누르면 게시글 작성이 열려요.' : (acct.generatedAccount ? '생성계정 게시글 작성' : '빈자리 메꾸기')} onClick={async (e) => {
                                    e.stopPropagation();
                                    // 기존 OnSale 게시물 또는 이용중 파티원에서 정보 가져오기
                                    const refOnSale = vi.onSaleList[0];
                                    // 이용중 파티원에서 폴백 정보 (endDateTime, price, keepMemo)
                                    const usingMember = acct.members.find(m => m.status === 'Using' || m.status === 'UsingNearExpiration');
                                    const anyMember = acct.members.find(m => m.endDateTime && m.purePrice > 0);
                                    const refMember = usingMember || anyMember;

                                    const autoPasswd = refOnSale?.keepPasswd || acct.keepPasswd || findPasswdByEmail(acct.email, acct.serviceType, vi.onSaleList);

                                    // keepMemo: 계정 접근 링크 템플릿을 기본값으로 둔 뒤 Email Dashboard alias/PIN 존재 여부만 확인
                                    const fillNickname = generateProfileNickname();
                                    const fallbackDeliveryMemo = buildAutoFillDeliveryMemo(fillNickname, PARTY_ACCESS_URL_PLACEHOLDER);
                                    setFillProfileNickname(fillNickname);

                                    // endDateTime: OnSale 게시글 > 이용중 파티원의 endDateTime
                                    const refEndDateTime = refOnSale?.endDateTime || refMember?.endDateTime || '';

                                    // 가격: OnSale 게시글 > 이용중 파티원의 purePrice (일당 계산 후 총액)
                                    let refPrice = refOnSale?.price?.replace(/[^0-9]/g,'') || '';
                                    let refPriceMode: 'total' | 'daily' = 'total';
                                    let refDailyPrice = '';
                                    if (!refPrice && refMember && refMember.purePrice > 0 && refMember.startDateTime && refMember.endDateTime) {
                                      // 이용중 파티원의 일당가를 계산해서 일당 모드로 세팅
                                      const parseDate = (d: string) => {
                                        const c = d.match(/^(\d{4})(\d{2})(\d{2})T/);
                                        if (c) return new Date(`${c[1]}-${c[2]}-${c[3]}`);
                                        // "26. 07. 11" -> "2026-07-11"
                                        const sh = d.replace(/\s/g,'').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
                                        if (sh) { const y = parseInt(sh[1]); return new Date(`${y<50?2000+y:1900+y}-${sh[2].padStart(2,'0')}-${sh[3].padStart(2,'0')}`); }
                                        return new Date(d.replace(/\s/g,'').replace(/\./g,'-').replace(/-$/,''));
                                      };
                                      const s = parseDate(refMember.startDateTime);
                                      const e = parseDate(refMember.endDateTime);
                                      const days = Math.max(1, Math.ceil((e.getTime()-s.getTime())/86400000));
                                      const daily = Math.ceil(refMember.purePrice / days);
                                      refDailyPrice = daily.toLocaleString();
                                      refPriceMode = 'daily';
                                    }

                                    setFillModal({
                                      email: acct.email,
                                      serviceType: acct.serviceType,
                                      keepAcct: acct.email,
                                      keepPasswd: autoPasswd,
                                      keepMemo: fallbackDeliveryMemo,
                                      vacancy: vi.unfilled,
                                      productName: refOnSale?.productName || `✅ 이메일 코드 언제든지 셀프인증 가능! ✅ ${acct.serviceType} 프리미엄!`,
                                      category: svcToCategory(acct.serviceType),
                                    });
                                    setFillCount(vi.unfilled);
                                    setFillPrice(refPrice ? Number(refPrice).toLocaleString() : '');
                                    setFillDailyPrice(refDailyPrice);
                                    setFillPriceMode(refPriceMode);
                                    setFillEndDate(refEndDateTime ? parseGraytagDate(refEndDateTime) : '');
                                    setFillKeepMemo(fallbackDeliveryMemo || '');
                                    setFillAliasStatus(null);
                                    setFillResult(null);
                                    setFillRank(null);
                                    await loadFillMemoFromEmailDashboard(acct.email, acct.serviceType, fallbackDeliveryMemo, fillNickname);
                                  }} style={{
                                    width: '100%', marginTop: 8, padding: '10px 14px', borderRadius: 10,
                                    background: isGeneratedPending ? '#F3F4F6' : '#FFF0F0', border: `1.5px solid ${isGeneratedPending ? '#E5E7EB' : '#FCA5A5'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: isGeneratedPending ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: isGeneratedPending ? '#9CA3AF' : '#EF4444',
                                  }}>
                                    <PlusCircle size={14} /> {fillActionLabel}
                                  </button>
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
          </div>
        </>
      )}
      {/* 메꾸기 모달 */}
      {fillModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={() => setFillModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:480, background:'#fff', borderRadius:'24px 24px 0 0', padding:'20px 20px env(safe-area-inset-bottom)', maxHeight:'80vh', overflow:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:'#1E1B4B' }}>파티원 메꾸기</div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{fillModal.email} · {fillModal.serviceType}</div>
              </div>
              <button onClick={() => setFillModal(null)} style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><X size={20} color="#9CA3AF" /></button>
            </div>

            <div style={{ background:'#FFF0F0', borderRadius:12, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#EF4444', fontWeight:600 }}>
              <UserX size={13} style={{ marginRight:6, verticalAlign:'middle' }} />
              {fillModal.vacancy}자리 비어있음 → 모집 게시글 자동 등록
            </div>

            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>종료일 *</label>
            <input type="date" value={fillEndDate} min={tomorrow()} onChange={e => setFillEndDate(e.target.value)}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:13, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />

            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
              <label style={{ fontSize:12, fontWeight:700, color:'#6B7280' }}>
                {fillPriceMode === 'total' ? '총 가격 (원) *' : '일당 가격 (원) *'}
              </label>
              <button onClick={toggleFillPriceMode} style={{
                background:'#EDE9FE', border:'none', borderRadius:8, padding:'4px 10px',
                fontSize:11, color:'#7C3AED', fontWeight:600, cursor:'pointer', fontFamily:'inherit',
              }}>
                {fillPriceMode === 'total' ? '↔ 일당으로 입력' : '↔ 총액으로 입력'}
              </button>
            </div>

            {fillPriceMode === 'total' ? (
              <input type="text" inputMode="numeric" value={fillPrice} placeholder="예: 11,900"
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g,'');
                  setFillPrice(raw ? Number(raw).toLocaleString() : '');
                  setFillRank(null);
                  // 총액 모드에서도 일당 계산 후 순위 조회
                  const total = parseInt(raw || '0');
                  const days = fillCalcDays();
                  const catKey = CATEGORIES.find(c => c.label === fillModal?.serviceType || fillModal?.serviceType?.includes(c.label.slice(0,3)))?.key;
                  if (total > 0 && days > 0 && catKey) {
                    const daily = Math.ceil(total / days);
                    clearTimeout((window as any).__fillRankTimer);
                    (window as any).__fillRankTimer = setTimeout(() => fetchFillRank(daily, catKey), 500);
                  }
                }}
                style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:13, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />
            ) : (
              <input type="text" inputMode="numeric" value={fillDailyPrice} placeholder="예: 132"
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g,'');
                  setFillDailyPrice(raw ? Number(raw).toLocaleString() : '');
                  setFillRank(null);
                  // 일당 입력 시 자동 순위 조회
                  const d = parseInt(raw || '0');
                  const catKey = CATEGORIES.find(c => c.label === fillModal?.serviceType || fillModal?.serviceType?.includes(c.label.slice(0,3)))?.key;
                  if (d > 0 && catKey) {
                    clearTimeout((window as any).__fillRankTimer);
                    (window as any).__fillRankTimer = setTimeout(() => fetchFillRank(d, catKey), 500);
                  }
                }}
                style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:13, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />
            )}

            {/* 계산 결과 */}
            {fillInfo && (
              <div style={{ background:'#F8F6FF', borderRadius:10, padding:'8px 12px', marginBottom:10 }}>
                {fillPriceMode === 'total' ? (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#6B7280' }}>
                    <span>일당 <strong style={{ color:'#A78BFA' }}>{fillInfo.daily.toLocaleString()}원</strong></span>
                    <span>{fillInfo.days}일 기준</span>
                  </div>
                ) : (
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#6B7280' }}>
                    <span>총 <strong style={{ color:'#A78BFA' }}>{fillInfo.total.toLocaleString()}원</strong></span>
                    <span>{fillInfo.days}일 × {fillInfo.daily.toLocaleString()}원</span>
                  </div>
                )}
              </div>
            )}

            {/* 가격 비교 순위 */}
            {fillRankLoading && <div style={{ fontSize:11, color:'#C4B5FD', marginBottom:8 }}>순위 계산 중...</div>}
            {!fillRankLoading && fillRank && (
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <div style={{
                  padding:'4px 12px', borderRadius:8, fontSize:13, fontWeight:700,
                  background: fillRank.rank === 1 ? '#A78BFA' : fillRank.rank <= 3 ? '#C4B5FD' : fillRank.rank <= 5 ? '#EDE9FE' : '#F3F4F6',
                  color: fillRank.rank <= 3 ? '#fff' : '#6B7280',
                }}>
                  {fillRank.rank}위
                </div>
                <span style={{ fontSize:12, color:'#6B7280' }}>/ {fillRank.total}개 중</span>
                {fillRank.rank === 1 && <span style={{ fontSize:12, color:'#059669', fontWeight:700 }}>🏆 최저가!</span>}
                {fillRank.rank > 5 && <span style={{ fontSize:11, color:'#9CA3AF' }}>가격을 낮춰보세요</span>}
              </div>
            )}

            {fillFinalPrice > 0 && fillFinalPrice < 1000 && (
              <div style={{ fontSize:11, color:'#EF4444', marginBottom:8 }}>최소 1,000원 이상이어야 합니다</div>
            )}

            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>배정된 프로필 이름 *</label>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input type="text" value={fillProfileNickname} placeholder="예: 수달이"
                onChange={e => {
                  const nickname = normalizeProfileNickname(e.target.value);
                  setFillProfileNickname(nickname);
                  const nextMemo = buildAutoFillDeliveryMemo(nickname, PARTY_ACCESS_URL_PLACEHOLDER);
                  setFillKeepMemo(nextMemo);
                  if (fillAliasStatus?.ok) setFillAliasStatus({ ...fillAliasStatus, memo: nextMemo });
                }}
                style={{ flex:1, padding:'11px 14px', borderRadius:10, border:`1.5px solid ${fillProfileNickname && !isValidProfileNickname(fillProfileNickname) ? '#FCA5A5' : '#EDE9FE'}`, fontSize:13, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', boxSizing:'border-box' }} />
              <button onClick={() => {
                const nickname = generateProfileNickname();
                setFillProfileNickname(nickname);
                const nextMemo = buildAutoFillDeliveryMemo(nickname, PARTY_ACCESS_URL_PLACEHOLDER);
                setFillKeepMemo(nextMemo);
                if (fillAliasStatus?.ok) setFillAliasStatus({ ...fillAliasStatus, memo: nextMemo });
              }} style={{ border:'none', borderRadius:10, padding:'0 12px', background:'#EDE9FE', color:'#7C3AED', fontSize:12, fontWeight:800, cursor:'pointer', fontFamily:'inherit' }}>
                랜덤
              </button>
            </div>
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, padding:'8px 10px', marginBottom:10, fontSize:11, color:'#92400E', fontWeight:700 }}>
                  ✅ 계정 접근 링크는 등록할 때 게시글마다 실제 주소로 자동 생성됩니다. 아래 미리보기의 {'{계정 접근 토큰 생성 주소}'} 자리에는 실제 access 주소가 들어갑니다.
            </div>

            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>추가 안내 (계정 전달 메모)</label>
            {fillAliasLoading && (
              <div style={{ background:'#F3F0FF', borderRadius:10, padding:'8px 10px', marginBottom:8, fontSize:11, color:'#7C3AED', fontWeight:700 }}>
                이메일 대시보드 DB에서 이메일/PIN 자동 조회 중...
              </div>
            )}
            {fillAliasStatus && (
              <div style={{ background: fillAliasStatus.ok ? '#ECFDF5' : '#FFF0F0', border:`1px solid ${fillAliasStatus.ok ? '#6EE7B7' : '#FCA5A5'}`, borderRadius:10, padding:'8px 10px', marginBottom:8, fontSize:11, color: fillAliasStatus.ok ? '#059669' : '#EF4444', fontWeight:700 }}>
                {fillAliasStatus.ok ? '자동 입력 완료' : '이메일/PIN 정보 없음'} · {fillAliasStatus.message}
              </div>
            )}
            <textarea value={fillKeepMemo} readOnly={fillAliasStatus?.ok === true} onChange={e => setFillKeepMemo(e.target.value)}
              placeholder={fillAliasStatus?.ok ? '이메일 대시보드 DB에서 자동 입력됐어요' : '이메일/PIN 정보가 있으면 자동으로 채워져요'}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:12, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box', height:180, resize:'vertical' }} />

            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>등록 개수</label>
            <div style={{ display:'flex', gap:6, marginBottom:14 }}>
              {Array.from({length: fillModal.vacancy}, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => setFillCount(n)} style={{
                  flex:1, padding:'8px 4px', borderRadius:10, border:'none', fontFamily:'inherit',
                  fontSize:14, fontWeight:700, cursor:'pointer',
                  background: fillCount === n ? '#A78BFA' : '#EDE9FE',
                  color: fillCount === n ? '#fff' : '#7C3AED',
                }}>{n}</button>
              ))}
            </div>

            {fillResult && (
              <div style={{ background: /오류|실패|차단/.test(fillResult) ? '#FFF0F0' : '#F0FDF4', borderRadius:10, padding:'8px 14px', marginBottom:10, fontSize:12, color: /오류|실패|차단/.test(fillResult) ? '#EF4444' : '#059669', fontWeight:600 }}>{fillResult}</div>
            )}

            <button onClick={handleFill} disabled={fillLoading || fillAliasLoading || !isValidProfileNickname(fillProfileNickname) || fillAliasStatus?.ok !== true || fillAliasStatus?.email !== fillModal.keepAcct || fillAliasStatus?.serviceType !== fillModal.serviceType || !fillEndDate || fillFinalPrice < 1000} style={{
              width:'100%', padding:14, borderRadius:12, border:'none',
              background: (fillLoading || fillAliasLoading || !isValidProfileNickname(fillProfileNickname) || fillAliasStatus?.ok !== true || fillAliasStatus?.email !== fillModal.keepAcct || fillAliasStatus?.serviceType !== fillModal.serviceType) ? '#C4B5FD' : '#A78BFA', color:'#fff', fontSize:15, fontWeight:700,
              cursor: (fillLoading || fillAliasLoading || !isValidProfileNickname(fillProfileNickname) || fillAliasStatus?.ok !== true || fillAliasStatus?.email !== fillModal.keepAcct || fillAliasStatus?.serviceType !== fillModal.serviceType) ? 'not-allowed' : 'pointer', fontFamily:'inherit',
              boxShadow:'0 4px 16px rgba(167,139,250,0.35)',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            }}>
              {fillLoading || fillAliasLoading ? <Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> : <PlusCircle size={16} />}
              {fillAliasLoading ? '이메일/PIN 조회 중...' : fillLoading ? '등록 중...' : `${fillCount}개 모집 게시글 등록`}
            </button>
          </div>
        </div>
      )}

      {/* ─── 수동 파티원 추가 모달 ──────────────────────── */}
      {addManualModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' }} onClick={() => setAddManualModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:480, background:'#fff', borderRadius:'24px 24px 0 0', padding:'20px 20px env(safe-area-inset-bottom)', maxHeight:'85vh', overflow:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:'#1E1B4B', display:'flex', alignItems:'center', gap:8 }}>
                  <UserPlus size={18} color="#059669" /> 수동 파티원 추가
                </div>
                <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{addManualModal.accountEmail} · {addManualModal.serviceType}</div>
              </div>
              <button onClick={() => setAddManualModal(null)} style={{ background:'none', border:'none', cursor:'pointer', padding:4 }}><X size={20} color="#9CA3AF" /></button>
            </div>

            <div style={{ background:'#ECFDF5', borderRadius:12, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#059669', fontWeight:600 }}>
              <UserPlus size={13} style={{ marginRight:6, verticalAlign:'middle' }} />
              그레이태그 외부에서 유입된 파티원을 수동 기록합니다
            </div>

            {/* 파티원 이름 */}
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>파티원 이름 *</label>
            <input type="text" value={mmName} placeholder="예: 홍길동"
              onChange={e => setMmName(e.target.value)}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #D1FAE5', fontSize:13, color:'#1E1B4B', background:'#F0FDF4', outline:'none', fontFamily:'inherit', marginBottom:12, boxSizing:'border-box' }} />

            {/* 이용 기간 */}
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>이용 시작일 *</label>
            <input type="date" value={mmStartDate}
              onChange={e => setMmStartDate(e.target.value)}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #D1FAE5', fontSize:13, color:'#1E1B4B', background:'#F0FDF4', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />

            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>이용 종료일 *</label>
            <input type="date" value={mmEndDate} min={mmStartDate || undefined}
              onChange={e => setMmEndDate(e.target.value)}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #D1FAE5', fontSize:13, color:'#1E1B4B', background:'#F0FDF4', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />

            {/* 가격 */}
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>가격 (원) *</label>
            <input type="text" inputMode="numeric" value={mmPrice} placeholder="예: 11,900"
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9]/g,'');
                setMmPrice(raw ? Number(raw).toLocaleString() : '');
              }}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #D1FAE5', fontSize:13, color:'#1E1B4B', background:'#F0FDF4', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />

            {/* 가격 요약 */}
            {(() => {
              const info = calcManualDaily();
              if (!info) return null;
              return (
                <div style={{ background:'#F0FDF4', borderRadius:10, padding:'8px 12px', marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'#6B7280' }}>
                    <span>일당 <strong style={{ color:'#10B981' }}>{info.daily.toLocaleString()}원</strong></span>
                    <span>{info.days}일 기준 · 총 {info.total.toLocaleString()}원</span>
                  </div>
                </div>
              );
            })()}

            {/* 유입 출처 */}
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6 }}>유입 출처 (어디서 왔는지)</label>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
              {SOURCE_PRESETS.map(src => (
                <button key={src} onClick={() => { setMmSource(src); if (src !== '기타') setMmSourceCustom(''); }} style={{
                  padding:'6px 12px', borderRadius:8, border:'none', fontFamily:'inherit',
                  fontSize:11, fontWeight:600, cursor:'pointer',
                  background: mmSource === src ? '#10B981' : '#F3F4F6',
                  color: mmSource === src ? '#fff' : '#6B7280',
                }}>{src}</button>
              ))}
            </div>
            {mmSource === '기타' && (
              <input type="text" value={mmSourceCustom} placeholder="직접 입력 (예: 트위터, 오픈채팅 등)"
                onChange={e => setMmSourceCustom(e.target.value)}
                style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #D1FAE5', fontSize:13, color:'#1E1B4B', background:'#F0FDF4', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box' }} />
            )}

            {/* 메모 */}
            <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', marginBottom:6, marginTop:4 }}>메모 (선택)</label>
            <textarea value={mmMemo} placeholder="연락처, 특이사항 등"
              onChange={e => setMmMemo(e.target.value)}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #D1FAE5', fontSize:12, color:'#1E1B4B', background:'#F0FDF4', outline:'none', fontFamily:'inherit', marginBottom:14, boxSizing:'border-box', height:60, resize:'vertical' }} />

            {/* 결과 */}
            {mmResult && (
              <div style={{ background: mmResult.includes('오류') ? '#FFF0F0' : '#F0FDF4', borderRadius:10, padding:'8px 14px', marginBottom:10, fontSize:12, fontWeight:600, color: mmResult.includes('오류') ? '#EF4444' : '#059669' }}>
                {mmResult}
              </div>
            )}

            <button onClick={handleAddManual}
              disabled={mmLoading || !mmName || !mmStartDate || !mmEndDate || !mmPrice}
              style={{
                width:'100%', padding:14, borderRadius:12, border:'none',
                background: mmLoading ? '#6EE7B7' : '#10B981', color:'#fff', fontSize:15, fontWeight:700,
                cursor: (mmLoading || !mmName || !mmStartDate || !mmEndDate || !mmPrice) ? 'not-allowed' : 'pointer',
                fontFamily:'inherit',
                boxShadow:'0 4px 16px rgba(16,185,129,0.35)',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                opacity: (!mmName || !mmStartDate || !mmEndDate || !mmPrice) ? 0.5 : 1,
              }}>
              {mmLoading ? <Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> : <UserPlus size={16} />}
              {mmLoading ? '추가 중...' : '파티원 추가'}
            </button>
          </div>
        </div>
      )}

      <div style={{ height:20 }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.4} 50%{opacity:.7}}`}</style>
    </div>
  );
}
