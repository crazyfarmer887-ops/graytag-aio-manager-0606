import { useState, useEffect } from "react";
import { CATEGORIES } from "../lib/constants";
import { buildAccountSlotStates, dedupeRecruitingProducts, mergeRecruitingProducts, type SlotState } from "../lib/account-slots";
import { removeRecruitingProductFromManageData } from "../lib/manage-optimistic";
import { assertAutoDeliveryInput, buildFillProductModel } from "../../lib/graytag-fill";
import { buildProfileAuditRows, summarizeProfileAudit, type ProfileAuditRow, type ProfileAuditStore } from "../../lib/profile-audit";
import { RefreshCw, KeyRound, Mail, ChevronDown, ChevronRight, TrendingUp, Loader2, AlertCircle, ExternalLink, Calendar, UserX, Megaphone, PlusCircle, X, UserPlus, Trash2, Activity, Wifi, WifiOff } from "lucide-react";

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
}
interface ServiceGroup { serviceType: string; accounts: Account[]; totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number; }
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
};
const getPartyMax = (svc: string) => PARTY_MAX[svc] || 6;

const USING_SET = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
const ACTIVE_SET = new Set(['Using','UsingNearExpiration','Delivered','Delivering','DeliveredAndCheckPrepaid','LendingAcceptanceWaiting','Reserved','OnSale']);
const VERIFYING_SET = new Set(['DeliveredAndCheckPrepaid']);

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  Using:                       { label:'이용 중',   color:'#7C3AED', bg:'#F5F3FF' },
  UsingNearExpiration:         { label:'만료 임박',  color:'#D97706', bg:'#FFFBEB' },
  DeliveredAndCheckPrepaid:    { label:'계정 확인중', color:'#D97706', bg:'#FFFBEB' },
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

type FilterMode = 'using'|'active'|'all';

interface ProfileAuditProgress {
  status: 'idle' | 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  percent: number;
  currentServiceType: string | null;
  currentAccountEmail: string | null;
  message: string;
}

function ProfileAuditPanel({ data, manualMembers }: { data: ManageData; manualMembers: ManualMember[] }) {
  const [rows, setRows] = useState<ProfileAuditRow[]>(() => buildProfileAuditRows(data as any, manualMembers as any, {}));
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProfileAuditProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshRows = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/profile-audit/results');
      const json = await res.json() as { results?: ProfileAuditStore; progress?: ProfileAuditProgress; error?: string };
      if (!res.ok) throw new Error(json.error || '프로필 검증 결과 조회 실패');
      setProgress(json.progress || null);
      setRows(buildProfileAuditRows(data as any, manualMembers as any, json.results || {}));
    } catch (e: any) {
      setError(e.message || '프로필 검증 결과 조회 실패');
      setRows(buildProfileAuditRows(data as any, manualMembers as any, {}));
    } finally { setLoading(false); }
  };

  useEffect(() => { refreshRows(); }, [data, manualMembers]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const loadProgress = async () => {
      try {
        const res = await fetch('/api/profile-audit/progress');
        const json = await res.json() as { progress?: ProfileAuditProgress };
        if (!cancelled && json.progress) setProgress(json.progress);
      } catch { /* progress polling is best-effort */ }
    };
    loadProgress();
    const timer = window.setInterval(loadProgress, 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [running]);

  const runCheck = async () => {
    const targetRows = rows.filter(row => row.status === 'unchecked' || row.status === 'mismatch' || row.status === 'error').slice(0, 20);
    const rowsWithSecrets = targetRows.map(row => {
      const account = data.services
        .flatMap(service => service.accounts)
        .find(account => account.serviceType === row.serviceType && account.email === row.accountEmail);
      return row.serviceType === '넷플릭스' ? { ...row, keepPasswd: account?.keepPasswd || '' } : row;
    });
    if (targetRows.length === 0) return;
    setProgress({
      status: 'running', total: targetRows.length, completed: 0, percent: 0,
      currentServiceType: null, currentAccountEmail: null, message: '프로필 검증을 시작했어요.',
    });
    setRunning(true); setError(null);
    try {
      const res = await fetch('/api/profile-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsWithSecrets }),
      });
      const json = await res.json() as { results?: ProfileAuditStore; progress?: ProfileAuditProgress; error?: string };
      if (json.progress) setProgress(json.progress);
      if (!res.ok) throw new Error(json.error || '프로필 검증 실행 실패');
      setRows(buildProfileAuditRows(data as any, manualMembers as any, json.results || {}));
    } catch (e: any) {
      setError(e.message || '프로필 검증 실행 실패');
    } finally { setRunning(false); }
  };

  const summary = summarizeProfileAudit(rows);
  const activeProgress = progress && (running || progress.status === 'running' || progress.status === 'completed' || progress.status === 'failed');
  const progressPercent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${progressPercent}%` : '0/0 · 0%';
  const tone = summary.mismatch > 0 ? '#EF4444' : summary.match > 0 ? '#10B981' : '#A78BFA';
  const statusLabel = (row: ProfileAuditRow) => row.status === 'match' ? '일치'
    : row.status === 'mismatch' ? '불일치'
    : row.status === 'unsupported' ? '미지원'
    : row.status === 'error' ? '오류'
    : '미검증';
  const statusColor = (row: ProfileAuditRow) => row.status === 'match' ? '#059669'
    : row.status === 'mismatch' ? '#EF4444'
    : row.status === 'unsupported' ? '#9CA3AF'
    : row.status === 'error' ? '#DC2626'
    : '#7C3AED';

  return (
    <div style={{ background:'#fff', borderRadius:18, padding:14, marginBottom:14, boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:'1.5px solid #F3F0FF' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:10 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:14, fontWeight:800, color:'#1E1B4B' }}>
            <Activity size={15} color={tone} /> 프로필 수 검증
          </div>
          <div style={{ fontSize:11, color:'#9CA3AF', marginTop:3 }}>실제 OTT 프로필 수와 계정관리 파티원 수 비교</div>
        </div>
        <button onClick={runCheck} disabled={running || loading || rows.length === 0}
          style={{ border:'none', borderRadius:12, padding:'8px 11px', background:'#EDE9FE', color:'#7C3AED', fontSize:11, fontWeight:800, cursor:running?'not-allowed':'pointer', display:'flex', alignItems:'center', gap:5 }}>
          {running ? <Loader2 size={13} style={{ animation:'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
          {running ? '검증중' : '검증 시작'}
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:10, textAlign:'center' }}>
        {[
          ['전체', summary.total, '#6B7280'], ['일치', summary.match, '#059669'], ['불일치', summary.mismatch, '#EF4444'], ['미검증', summary.unchecked + summary.unsupported, '#7C3AED'],
        ].map(([label, value, color]) => (
          <div key={String(label)} style={{ background:'#F8F6FF', borderRadius:10, padding:'7px 4px' }}>
            <div style={{ fontSize:14, fontWeight:900, color: String(color) }}>{String(value)}</div>
            <div style={{ fontSize:9, color:'#9CA3AF', marginTop:2 }}>{String(label)}</div>
          </div>
        ))}
      </div>
      {activeProgress && <div style={{ background:'#F8F6FF', border:'1px solid #EDE9FE', borderRadius:12, padding:'9px 10px', marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:6 }}>
          <div style={{ fontSize:11, fontWeight:900, color:'#1E1B4B' }}>검증 진척도</div>
          <div style={{ fontSize:11, fontWeight:900, color:progress?.status === 'failed' ? '#EF4444' : '#7C3AED' }}>{progressLabel}</div>
        </div>
        <div style={{ height:8, borderRadius:999, background:'#EDE9FE', overflow:'hidden' }}>
          <div style={{ width:`${progressPercent}%`, height:'100%', borderRadius:999, background:progress?.status === 'failed' ? '#EF4444' : 'linear-gradient(90deg,#A78BFA,#7C3AED)', transition:'width .25s ease' }} />
        </div>
        <div style={{ fontSize:10, color:'#7C3AED', marginTop:6, lineHeight:1.35 }}>
          {progress?.message || '프로필 검증 상태를 확인하는 중이에요.'}
          {progress?.currentAccountEmail && <span style={{ color:'#9CA3AF' }}> · {progress.currentServiceType} {progress.currentAccountEmail}</span>}
        </div>
      </div>}
      {error && <div style={{ background:'#FFF0F0', color:'#EF4444', borderRadius:10, padding:'8px 10px', fontSize:11, marginBottom:8 }}>{error}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:7, maxHeight:260, overflowY:'auto' }}>
        {rows.slice(0, 12).map(row => (
          <div key={row.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'#FAFAFF', border:'1px solid #F3F0FF', borderRadius:12, padding:'9px 10px' }}>
            <div style={{ minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                <span style={{ fontSize:12, fontWeight:800, color:'#1E1B4B' }}>{row.serviceType}</span>
                <span style={{ fontSize:10, fontWeight:800, color:statusColor(row), background:'#fff', borderRadius:999, padding:'2px 7px' }}>{statusLabel(row)}</span>
              </div>
              <div style={{ fontSize:10, color:'#9CA3AF', marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{row.accountEmail}</div>
              {row.message && <div style={{ fontSize:9, color:'#C084FC', marginTop:3 }}>{row.message}</div>}
            </div>
            <div style={{ textAlign:'right', flexShrink:0 }}>
              <div style={{ fontSize:12, fontWeight:900, color:'#1E1B4B' }}>{row.actualProfileCount ?? '-'} / {row.expectedPartyCount}</div>
              <div style={{ fontSize:9, color:'#9CA3AF', marginTop:2 }}>실제 / 관리</div>
            </div>
          </div>
        ))}
      </div>
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
  const [fillAliasStatus, setFillAliasStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [fillAliasLoading, setFillAliasLoading] = useState(false);
  const [fillLoading, setFillLoading] = useState(false);
  const [fillResult, setFillResult] = useState<string|null>(null);
  const [fillRank, setFillRank] = useState<{rank:number;total:number}|null>(null);
  const [slAliases, setSlAliases] = useState<{id:number;email:string;pin:string|null}[]>([]);

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

  useEffect(() => {
    fetchManualMembers();
    fetchSessionStatus();
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

  useEffect(() => {
    fetch('/api/sl/aliases?page=0').then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json(); }).then((d: any) => {
      setSlAliases((d.aliases || []).filter((a: any) => a.enabled));
    }).catch(() => {});
  }, []);

  // 기존 keepMemo에서 PIN 추출 ("핀번호는 : XXXX입니다!" 패턴)
  const extractPinFromMemo = (memo?: string): string | null => {
    if (!memo) return null;
    const m = memo.match(/핀번호는 : (.+?)입니다!/);
    return m && m[1] && m[1] !== '{PIN}' ? m[1].trim() : null;
  };

  // 기존 keepMemo에서 이메일 ID 추출 ("/email/mail/XXXX" 패턴)
  const extractEmailIdFromMemo = (memo?: string): string | null => {
    if (!memo) return null;
    const m = memo.match(/\/email\/mail\/(\d+)/);
    return m ? m[1] : null;
  };

  // 서비스 타입으로 alias 찾기 (이메일 주소가 다르므로)
  const getAliasForService = (serviceType: string) => {
    // 서비스 타입에서 keyword 추출. Graytag 티빙 계정은 종종 "티방"/gtwavve/gtwalve로 보인다.
    const normalized = serviceType.toLowerCase();
    const keywords = /티빙|티방|tving|gtwavve|gtwalve/.test(normalized)
      ? ['tving']
      : [normalized];
    // slAliases에서 해당 서비스 이메일 찾기 (이메일에 서비스명 포함된 것)
    let serviceAliases = slAliases.filter(a =>
      a.enabled && keywords.some(keyword => a.email.toLowerCase().includes(keyword)) && a.pin
    );
    // 가장 최근의 alias 반환 (id가 높을수록 최근)
    return serviceAliases.length > 0 ? serviceAliases.sort((a, b) => b.id - a.id)[0] : null;
  };

  const makeKeepMemo = (email: string, serviceType: string, existingMemo?: string) => {
    // 1. keepAcct 이메일로 직접 alias 매칭 (가장 정확)
    let alias = slAliases.find(a => a.email === email && a.pin);
    // 2. 서비스 타입 키워드로 alias 검색
    if (!alias) alias = getAliasForService(serviceType);
    // 3. 실패 시 기존 메모에서 추출
    if (!alias) {
      const eid = extractEmailIdFromMemo(existingMemo);
      const pin = extractPinFromMemo(existingMemo);
      if (eid && pin) {
        alias = { id: parseInt(eid), email: 'unknown', enabled: true, pin, hasPin: true, creation_date: '', creation_timestamp: 0, nb_block: 0, nb_forward: 0, nb_reply: 0, note: '' };
      }
    }

    const pin = alias?.pin || '{PIN}';
    const eid = alias?.id || '{EMAIL_ID}';

    return `✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!! ✅
로그인 시도 간 필요한 이메일 코드는 아래 사이트에서 언제든지 셀프인증 가능합니다!
https://email-verify.xyz/email/mail/${eid}
사이트에서 필요한 핀번호는 : ${pin}입니다!

프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!
만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다! 예)홍길동 또는 홍*동
만약, 접속 시 기본 프로필 1개만 있거나 자리가 꽉 찼는데 기본 프로필이 있다면 그걸 먼저 수정하고 사용하시면 되겠습니다!

즐거운 시청되세요!`;
  };

  const loadFillMemoFromEmailDashboard = async (email: string, serviceType: string, fallbackMemo = '') => {
    setFillAliasLoading(true);
    setFillAliasStatus(null);
    try {
      const res = await fetch(`/api/email-alias-fill?email=${encodeURIComponent(email)}&serviceType=${encodeURIComponent(serviceType)}`);
      const data = await res.json() as any;
      if (res.ok && data?.ok && data.memo) {
        setFillKeepMemo(data.memo);
        setFillAliasStatus({ ok: true, message: `이메일 대시보드 DB에서 자동 입력됨: #${data.emailId}` });
        return data.memo as string;
      }

      const missing = Array.isArray(data?.missing) ? data.missing : [];
      const message = missing.includes('email')
        ? '이 계정 이메일이 이메일 대시보드 alias 목록에 없어요.'
        : missing.includes('pin')
          ? '이 계정 이메일의 PIN 번호가 이메일 대시보드에 없어요.'
          : (data?.message || data?.error || '이메일/PIN 정보를 찾지 못했어요.');
      setFillKeepMemo(fallbackMemo || '');
      setFillAliasStatus({ ok: false, message });
      return '';
    } catch (e: any) {
      setFillKeepMemo(fallbackMemo || '');
      setFillAliasStatus({ ok: false, message: `이메일 대시보드 조회 실패: ${e.message}` });
      return '';
    } finally {
      setFillAliasLoading(false);
    }
  };

  const findPasswdByEmail = (email: string, onSaleList: OnSaleProduct[]): string => {
    // 1st: from this email's onSale list
    const fromOnSale = onSaleList.find(p => p.keepPasswd)?.keepPasswd;
    if (fromOnSale) return fromOnSale;
    // 2nd: from any product matching this email
    if (data?.onSaleByKeepAcct) {
      for (const products of Object.values(data.onSaleByKeepAcct)) {
        const found = (products as OnSaleProduct[]).find(p => p.keepAcct === email && p.keepPasswd)?.keepPasswd;
        if (found) return found;
      }
    }
    // 3rd fallback: ANY product with a password from ANY account
    if (data?.onSaleByKeepAcct) {
      for (const products of Object.values(data.onSaleByKeepAcct)) {
        const found = (products as OnSaleProduct[]).find(p => p.keepPasswd)?.keepPasswd;
        if (found) return found;
      }
    }
    return '';
  };
  const [fillRankLoading, setFillRankLoading] = useState(false);

  const doFetch = async (id?: string) => {
    const cs = cookies.find(c => c.id===(id||selectedId));
    if (!cs) return;
    setLoading(true); setError(null); setData(null);
    try {
      const body = cs.id === AUTO_COOKIE_ID ? {} : { AWSALB:cs.AWSALB, AWSALBCORS:cs.AWSALBCORS, JSESSIONID:cs.JSESSIONID };
      const res = await fetch('/api/my/management', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const json = await res.json() as any;
      if (!res.ok) setError(json.error);
      else { setData(json); if (json.services?.[0]) setOpenService(json.services[0].serviceType); }
    } catch (e: any) { setError(e.message); }
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
      '넷플릭스': 'Netflix', '티빙': 'tving', '유튜브': 'youtube',
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
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) return;
    setFillLoading(true); setFillResult(null);

    const count = Math.max(1, Math.min(fillCount, fillModal.vacancy));
    let success = 0;
    const createdProducts: OnSaleProduct[] = [];
    const priceNum = fillFinalPrice;

    const toGraytagDate = (ds: string) => {
      const d = new Date(ds);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T2359`;
    };

    for (let i = 0; i < count; i++) {
      try {
        const productModel = buildFillProductModel({
          category: fillModal.category,
          endDate: toGraytagDate(fillEndDate),
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

        // keepAcct 설정
        const deliveryInputError = assertAutoDeliveryInput({ keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: fillKeepMemo });
        if (deliveryInputError) {
          setFillResult(`계정 자동전달 준비 실패: ${deliveryInputError}`);
          continue;
        }
        const keepBody = cs.id === AUTO_COOKIE_ID
          ? { productUsid: json.productUsid, keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: fillKeepMemo }
          : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID, productUsid: json.productUsid, keepAcct: fillModal.keepAcct, keepPasswd: fillModal.keepPasswd, keepMemo: fillKeepMemo };
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
          keepMemo: fillKeepMemo,
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
    if (success > 0) setTimeout(() => { setFillModal(null); setFillResult(null); doFetch(); }, 3000);
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

  const sum = data?.summary;

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
                const mx = getPartyMax(acct.serviceType);
                const vac = Math.max(0, mx - acct.usingCount);
                const onSale = dedupeRecruitingProducts(data.onSaleByKeepAcct?.[acct.email] || [])
                  .filter(p => !p.productType || p.productType === acct.serviceType).length;
                totalUnfilled += Math.max(0, vac - onSale);
              }
            }
            if (totalUnfilled === 0) return null;
            return (
              <button onClick={async () => {
                if (!window.confirm(`빈 자리 ${totalUnfilled}개를 모두 메꾸기 하시겠습니까?`)) return;
                setFillLoading(true); setFillResult(null);
                const cs = cookies.find(c => c.id === selectedId);
                if (!cs) { setFillLoading(false); return; }
                let success = 0; let total = 0;
                const createdByKeepAcct: Record<string, OnSaleProduct[]> = {};
                const toGraytagDate = (ds: string) => { const d = new Date(ds); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T2359`; };
                for (const svc of data.services) {
                  for (const acct of svc.accounts) {
                    if (acct.email === '(직접전달)') continue;
                    const mx = getPartyMax(acct.serviceType);
                    const vac = Math.max(0, mx - acct.usingCount);
                    const onSaleList = dedupeRecruitingProducts(data.onSaleByKeepAcct?.[acct.email] || [])
                      .filter(p => !p.productType || p.productType === acct.serviceType);
                    const unfilled = Math.max(0, vac - onSaleList.length);
                    if (unfilled <= 0) continue;
                    const refProduct = onSaleList[0];
                    const passwd = refProduct?.keepPasswd || acct.keepPasswd || findPasswdByEmail(acct.email, onSaleList);
                    const memo = makeKeepMemo(acct.email, acct.serviceType, refProduct?.keepMemo);
                    const category = svcToCategory(acct.serviceType);
                    // 기존 게시글에서 종료일/가격 참조, 없으면 이용중 파티원에서 폴백
                    let endDate = refProduct?.endDateTime || '';
                    let price = refProduct?.purePrice || 0;
                    if (!endDate || price <= 0) {
                      const uMem = acct.members.find((m: any) => (m.status === 'Using' || m.status === 'UsingNearExpiration') && m.endDateTime && m.purePrice > 0);
                      if (uMem) {
                        if (!endDate) endDate = uMem.endDateTime || '';
                        if (price <= 0 && uMem.purePrice > 0 && uMem.startDateTime && uMem.endDateTime) {
                          // 일당가 계산 후 남은 기간에 맞춰 총액 산출
                          const pD = (d: string) => { const c = d.match(/^(\d{4})(\d{2})(\d{2})T/); if (c) return new Date(c[1]+'-'+c[2]+'-'+c[3]); const sh = d.replace(/\s/g,'').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/); if (sh) { const y=parseInt(sh[1]); return new Date((y<50?2000+y:1900+y)+'-'+sh[2].padStart(2,'0')+'-'+sh[3].padStart(2,'0')); } return new Date(d.replace(/\s/g,'').replace(/\./g,'-').replace(/-$/,'')); };
                          const s = pD(uMem.startDateTime); const e = pD(uMem.endDateTime);
                          const days = Math.max(1, Math.ceil((e.getTime()-s.getTime())/86400000));
                          const daily = Math.ceil(uMem.purePrice / days);
                          const today = new Date(); today.setHours(0,0,0,0);
                          const endD = pD(endDate || uMem.endDateTime);
                          const remain = Math.max(1, Math.ceil((endD.getTime()-today.getTime())/86400000));
                          price = daily * remain;
                        }
                      }
                    }
                    if (!endDate || price <= 0) continue;
                    for (let i = 0; i < unfilled; i++) {
                      total++;
                      try {
                        const productModel = buildFillProductModel({
                          category,
                          endDate: toGraytagDate(endDate),
                          price,
                          productName: refProduct?.productName || `✅ 이메일 코드 언제든지 셀프인증 가능! ✅ ${acct.serviceType} 프리미엄!`,
                          serviceType: acct.serviceType,
                        });
                        const body = cs.id === AUTO_COOKIE_ID ? { productModel } : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID, productModel };
                        const res = await fetch('/api/post/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        const json = await res.json() as any;
                        if (!res.ok || !json.productUsid) continue;
                        const deliveryInputError = assertAutoDeliveryInput({ keepAcct: acct.email, keepPasswd: passwd, keepMemo: memo });
                        if (deliveryInputError) continue;
                        const keepBody = cs.id === AUTO_COOKIE_ID
                          ? { productUsid: json.productUsid, keepAcct: acct.email, keepPasswd: passwd, keepMemo: memo }
                          : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID, productUsid: json.productUsid, keepAcct: acct.email, keepPasswd: passwd, keepMemo: memo };
                        const keepRes = await fetch('/api/post/keepAcct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(keepBody) });
                        if (!keepRes.ok) continue;
                        const createdProduct: OnSaleProduct = {
                          productUsid: String(json.productUsid),
                          productName: productModel.name,
                          productType: acct.serviceType,
                          price: `${price.toLocaleString()}원`,
                          purePrice: price,
                          endDateTime: toGraytagDate(endDate),
                          remainderDays: 0,
                          keepAcct: acct.email,
                          keepPasswd: passwd,
                          keepMemo: memo,
                        };
                        createdByKeepAcct[acct.email] = mergeRecruitingProducts(createdByKeepAcct[acct.email] || [], [createdProduct]);
                        success++;
                      } catch {}
                      await new Promise(r => setTimeout(r, 800));
                    }
                  }
                }
                setFillLoading(false);
                setFillResult(`전체 메꾸기: ${success}/${total}개 완료`);
                if (Object.keys(createdByKeepAcct).length > 0) {
                  setData(prev => {
                    if (!prev) return prev;
                    const nextOnSale = { ...prev.onSaleByKeepAcct };
                    for (const [keepAcct, additions] of Object.entries(createdByKeepAcct)) {
                      nextOnSale[keepAcct] = mergeRecruitingProducts(nextOnSale[keepAcct] || [], additions);
                    }
                    return { ...prev, onSaleByKeepAcct: nextOnSale };
                  });
                }
                setTimeout(() => { setFillResult(null); doFetch(); }, 2000);
              }} disabled={fillLoading} style={{ background:'#EF4444', border:'none', borderRadius:12, padding:'8px 14px', fontSize:13, color:'#fff', cursor:fillLoading?'not-allowed':'pointer', fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', gap:6 }}>
                <PlusCircle size={14} />
                {fillLoading ? '메꾸는 중...' : `전체 메꾸기 (${totalUnfilled})`}
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
                { label:'계정 수', value:`${sum!.totalAccounts}개` },
                { label:'이용 중', value:`${sum!.totalUsingMembers}명` },
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

          <ProfileAuditPanel data={data} manualMembers={manualMembers} />

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
              return (
                <div key={svc.serviceType} style={{ background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:`1.5px solid ${isOpen?'#A78BFA':'#F3F0FF'}` }}>
                  <button onClick={() => setOpenService(isOpen ? null : svc.serviceType)} style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                    <div style={{ width:40, height:40, borderRadius:12, background:sc.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {logo ? <img src={logo} alt={svc.serviceType} style={{ width:26, height:26, objectFit:'contain' }} onError={e=>{(e.target as HTMLImageElement).style.display='none';}} /> : null}
                    </div>
                    <div style={{ flex:1, textAlign:'left' }}>
                      <div style={{ fontSize:15, fontWeight:700, color:'#1E1B4B' }}>{svc.serviceType}</div>
                      <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>계정 {svc.accounts.length}개 · 이용중 {svc.totalUsingMembers}명</div>
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
                          if (filter==='using') return USING_SET.has(m.status);
                          if (filter==='active') return ACTIVE_SET.has(m.status);
                          return true;
                        });
                        const hasOnSale = (data?.onSaleByKeepAcct?.[acct.email]?.length ?? 0) > 0;
                        if (filter !== 'all' && acct.usingCount===0 && acct.activeCount===0 && !hasOnSale) return null;
                        const filledSlots = acct.usingCount || acct.activeCount;
                        const totalSlots = getPartyMax(acct.serviceType);
                        const fillPct = Math.round((filledSlots/totalSlots)*100);
                        const partyInfo = calcPartyDuration(acct.members);
                        const vi = getVacancyInfo(acct);
                        const verifyingCount = acct.members.filter(m => VERIFYING_SET.has(m.status)).length;
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
                            <button onClick={() => setOpenAccount(isAcctOpen ? null : acctKey)} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 14px', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                              {/* 슬롯 게이지 */}
                              <div style={{ flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:3, minWidth:36 }}>
                                <div style={{ display:'flex', gap:3 }}>
                                  {slotStates.map((state: SlotState, i) => {
                                    const filled = state !== 'empty';
                                    const background = state === 'using' ? '#A78BFA'
                                      : state === 'verifying' ? '#D97706'
                                      : state === 'manual' ? '#10B981'
                                      : state === 'recruiting' ? '#D1D5DB'
                                      : state === 'active' ? '#C4B5FD'
                                      : '#E9E4FF';
                                    const title = state === 'using' ? '이용중'
                                      : state === 'verifying' ? '계정 확인중'
                                      : state === 'manual' ? '수동파티원'
                                      : state === 'recruiting' ? '모집 게시글 등록됨'
                                      : state === 'active' ? '활성'
                                      : '비어있음';
                                    return (
                                      <div key={i} style={{ width: filled?7:6, height: filled?18:14, borderRadius:3,
                                        background,
                                        alignSelf:'flex-end', title }} />
                                    );
                                  })}
                                </div>
                                <div style={{ fontSize:9, color:'#9CA3AF' }}>{acct.usingCount + vi.manualCount}/{totalSlots}</div>
                              </div>
                              <div style={{ flex:1, textAlign:'left', minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                  <Mail size={12} color="#9CA3AF" />
                                  <span style={{ fontSize:12, fontWeight:700, color:'#1E1B4B', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{acct.email}</span>
                                </div>
                                <div style={{ display:'flex', gap:6, alignItems:'center', marginTop:3, flexWrap:'wrap' }}>
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
                                            void doFetch();
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
                                {filteredMembers.length === 0 ? (
                                  <div style={{ fontSize:12, color:'#9CA3AF', textAlign:'center', padding:'8px 0' }}>해당 조건의 파티원 없음</div>
                                ) : filteredMembers.map((m, idx) => {
                                  const b = bge(m.status, m.statusName);
                                  const isVerifying = VERIFYING_SET.has(m.status);
                                  const isUsing = USING_SET.has(m.status);
                                  const circleBg = isVerifying ? '#D97706' : isUsing ? '#A78BFA' : ACTIVE_SET.has(m.status) ? '#C4B5FD' : '#E9E4FF';
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
                                  const manuals = getManualForAccount(acct.email, acct.serviceType);
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
                                  <button onClick={async (e) => {
                                    e.stopPropagation();
                                    // 기존 OnSale 게시물 또는 이용중 파티원에서 정보 가져오기
                                    const refOnSale = vi.onSaleList[0];
                                    // 이용중 파티원에서 폴백 정보 (endDateTime, price, keepMemo)
                                    const usingMember = acct.members.find(m => m.status === 'Using' || m.status === 'UsingNearExpiration');
                                    const anyMember = acct.members.find(m => m.endDateTime && m.purePrice > 0);
                                    const refMember = usingMember || anyMember;

                                    const autoPasswd = refOnSale?.keepPasswd || acct.keepPasswd || findPasswdByEmail(acct.email, vi.onSaleList);

                                    // keepMemo: OnSale > 이용중 멤버의 keepMemo(API에서 안 줌) > slAliases 기반 생성
                                    const existingMemo = refOnSale?.keepMemo || '';

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
                                      keepMemo: existingMemo,
                                      vacancy: vi.unfilled,
                                      productName: refOnSale?.productName || `✅ 이메일 코드 언제든지 셀프인증 가능! ✅ ${acct.serviceType} 프리미엄!`,
                                      category: svcToCategory(acct.serviceType),
                                    });
                                    setFillCount(vi.unfilled);
                                    setFillPrice(refPrice ? Number(refPrice).toLocaleString() : '');
                                    setFillDailyPrice(refDailyPrice);
                                    setFillPriceMode(refPriceMode);
                                    setFillEndDate(refEndDateTime ? parseGraytagDate(refEndDateTime) : '');
                                    setFillKeepMemo(existingMemo || '');
                                    setFillAliasStatus(null);
                                    setFillResult(null);
                                    setFillRank(null);
                                    await loadFillMemoFromEmailDashboard(acct.email, acct.serviceType, existingMemo);
                                  }} style={{
                                    width: '100%', marginTop: 8, padding: '10px 14px', borderRadius: 10,
                                    background: '#FFF0F0', border: '1.5px solid #FCA5A5',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#EF4444',
                                  }}>
                                    <PlusCircle size={14} /> {vi.unfilled}자리 메꾸기
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
            <textarea value={fillKeepMemo} onChange={e => setFillKeepMemo(e.target.value)}
              placeholder={fillAliasStatus?.ok ? '이메일 대시보드 DB에서 자동 입력됐어요' : '이메일/PIN 정보가 있으면 자동으로 채워져요'}
              style={{ width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:12, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:10, boxSizing:'border-box', height:80, resize:'vertical' }} />

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
              <div style={{ background:'#F0FDF4', borderRadius:10, padding:'8px 14px', marginBottom:10, fontSize:12, color:'#059669', fontWeight:600 }}>{fillResult}</div>
            )}

            <button onClick={handleFill} disabled={fillLoading || fillAliasLoading || fillAliasStatus?.ok === false || !fillEndDate || fillFinalPrice < 1000} style={{
              width:'100%', padding:14, borderRadius:12, border:'none',
              background: (fillLoading || fillAliasLoading || fillAliasStatus?.ok === false) ? '#C4B5FD' : '#A78BFA', color:'#fff', fontSize:15, fontWeight:700,
              cursor: (fillLoading || fillAliasLoading || fillAliasStatus?.ok === false) ? 'not-allowed' : 'pointer', fontFamily:'inherit',
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
