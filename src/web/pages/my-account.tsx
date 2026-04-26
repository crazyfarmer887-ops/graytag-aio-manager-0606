import { useState, useEffect } from "react";
import { CATEGORIES } from "../lib/constants";
import { Cookie, Plus, X, Trash2, Search, AlertCircle, ExternalLink, ChevronRight, Loader2, CheckCircle2, KeyRound, ClipboardList, Pencil, Users, Calendar, Clock, Zap } from "lucide-react";

interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
interface Deal {
  dealUsid: string; productUsid: string; productName: string; productType: string;
  counterpartName: string; price: string; remainderDays: number;
  endDateTime: string; dealStatus: string; dealStatusName: string;
}
interface AccountData { borrowerDeals: Deal[]; lenderDeals: Deal[]; totalBorrower: number; totalLender: number; }
interface ResultState { loading: boolean; data: AccountData | null; error: string | null; code?: string; }

// 관리 API의 파티원 정보
interface PartyMember {
  dealUsid: string; name: string | null; status: string; statusName: string;
  price: string; purePrice: number; realizedSum: number; progressRatio: string;
  startDateTime: string | null; endDateTime: string | null; remainderDays: number;
}
interface PartyAccount {
  email: string; serviceType: string; members: PartyMember[]; usingCount: number;
  activeCount: number; totalSlots: number; totalIncome: number; totalRealizedIncome: number; expiryDate: string | null;
}
interface PartyService { serviceType: string; accounts: PartyAccount[]; }
interface PartyData { services: PartyService[]; }

interface PartyPopupData {
  loading: boolean;
  data: PartyData | null;
  error: string | null;
  selectedEmail: string | null;
}

const AUTO_COOKIE_ID = '__session_keeper__';
const STORAGE_KEY = 'graytag_cookies_v2';
const load = (): CookieSet[] => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } };
const save = (cs: CookieSet[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(cs));

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  OnSale:                   { label: '판매 중',   color: '#059669', bg: '#ECFDF5' },
  Using:                    { label: '이용 중',   color: '#7C3AED', bg: '#F5F3FF' },
  UsingNearExpiration:      { label: '만료 임박',  color: '#D97706', bg: '#FFFBEB' },
  Delivered:                { label: '전달 완료',  color: '#2563EB', bg: '#EFF6FF' },
  Delivering:               { label: '전달 중',   color: '#0891B2', bg: '#ECFEFF' },
  Reserved:                 { label: '예약됨',    color: '#6366F1', bg: '#EEF2FF' },
  LendingAcceptanceWaiting: { label: '수락 대기',  color: '#D97706', bg: '#FFFBEB' },
  NormalFinished:           { label: '완료',      color: '#6B7280', bg: '#F3F4F6' },
  CancelByNoShow:           { label: '취소됨',    color: '#EF4444', bg: '#FFF0F0' },
  FinishedByBorrowerRequest:{ label: '중도 종료',  color: '#9CA3AF', bg: '#F9FAFB' },
  FinishedByLenderRequest:  { label: '중도 종료',  color: '#9CA3AF', bg: '#F9FAFB' },
};
const badge = (s: string, n: string) => STATUS_MAP[s] || { label: n||s, color: '#6B7280', bg: '#F3F4F6' };
const fmtDate = (s: string|null) => s ? s.replace(/\s/g,'').replace(/\.(?=\S)/g,'/').replace(/\.$/, '') : '-';
const fmtMoney = (n: number) => n > 0 ? n.toLocaleString()+'원' : '-';

export default function MyAccountPage() {
  const [cookies, setCookies] = useState<CookieSet[]>(load);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', AWSALB: '', AWSALBCORS: '', JSESSIONID: '' });
  const [jsonInput, setJsonInput] = useState('');
  const [inputMode, setInputMode] = useState<'json'|'manual'>('json');
  const [results, setResults] = useState<Record<string, ResultState>>({});
  const [tabs, setTabs] = useState<Record<string, 'borrower'|'lender'>>({});

  // 자동 쿠키 상태
  const [autoSession, setAutoSession] = useState<{ valid: boolean; JSESSIONID?: string; loading: boolean }>({ valid: false, loading: true });

  // 파티 팝업 상태
  const [partyPopup, setPartyPopup] = useState<Record<string, PartyPopupData>>({});
  const [showPopupFor, setShowPopupFor] = useState<{ cookieId: string; email: string } | null>(null);

  // 자동 쿠키 상태 체크 → 유효하면 즉시 자동 조회
  useEffect(() => {
    fetch('/api/session/cookies').then(r => r.json()).then((d: any) => {
      const valid = d.ok && d.valid;
      setAutoSession({ valid, JSESSIONID: d.JSESSIONID, loading: false });
      // 세션 유효하면 자동으로 조회 시작
      if (valid) {
        query(null, AUTO_COOKIE_ID);
      }
    }).catch(() => setAutoSession({ valid: false, loading: false }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addCookie = () => {
    if (!form.JSESSIONID.trim()) return;
    const c: CookieSet = { id: Date.now().toString(), label: form.label || `계정 ${cookies.length+1}`, AWSALB: form.AWSALB.trim(), AWSALBCORS: form.AWSALBCORS.trim(), JSESSIONID: form.JSESSIONID.trim() };
    const next = [...cookies, c]; setCookies(next); save(next);
    setForm({ label:'', AWSALB:'', AWSALBCORS:'', JSESSIONID:'' }); setJsonInput(''); setShowAdd(false);
  };

  const parseJson = () => {
    try {
      const arr = jsonInput.trim().startsWith('[') ? JSON.parse(jsonInput) : [JSON.parse(jsonInput)];
      const m: Record<string,string> = {};
      arr.forEach((x: any) => { if (x.name && x.value) m[x.name] = x.value; });
      if (!m['JSESSIONID']) return alert('JSESSIONID를 찾을 수 없어요');
      setForm(f => ({ ...f, AWSALB: m['AWSALB']||'', AWSALBCORS: m['AWSALBCORS']||'', JSESSIONID: m['JSESSIONID'] }));
    } catch { alert('JSON 형식이 올바르지 않아요'); }
  };

  const del = (id: string) => {
    const next = cookies.filter(c => c.id !== id); setCookies(next); save(next);
    setResults(r => { const n={...r}; delete n[id]; return n; });
  };

  // 자동 쿠키 또는 수동 쿠키로 조회
  const query = async (cs: CookieSet | null, id: string) => {
    setResults(r => ({ ...r, [id]: { loading: true, data: null, error: null } }));
    setTabs(t => ({ ...t, [id]: 'lender' }));
    try {
      const body = cs ? { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID } : {};
      const res = await fetch('/api/my/accounts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const json = await res.json() as any;
      if (!res.ok) setResults(r => ({ ...r, [id]: { loading: false, data: null, error: json.error, code: json.code } }));
      else setResults(r => ({ ...r, [id]: { loading: false, data: json, error: null } }));
    } catch (e: any) { setResults(r => ({ ...r, [id]: { loading: false, data: null, error: e.message } })); }
  };

  // 이메일 클릭 → 파티 정보 로드
  const loadPartyInfo = async (cs: CookieSet | null, id: string, email: string) => {
    const key = id;
    if (partyPopup[key]?.data) {
      setShowPopupFor({ cookieId: key, email });
      return;
    }

    setPartyPopup(prev => ({ ...prev, [key]: { loading: true, data: null, error: null, selectedEmail: email } }));
    setShowPopupFor({ cookieId: key, email });

    try {
      const body = cs ? { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID } : {};
      const res = await fetch('/api/my/management', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as any;
      if (!res.ok) {
        setPartyPopup(prev => ({ ...prev, [key]: { loading: false, data: null, error: json.error, selectedEmail: email } }));
      } else {
        setPartyPopup(prev => ({ ...prev, [key]: { loading: false, data: json, error: null, selectedEmail: email } }));
      }
    } catch (e: any) {
      setPartyPopup(prev => ({ ...prev, [key]: { loading: false, data: null, error: e.message, selectedEmail: email } }));
    }
  };

  // 팝업 렌더링
  const renderPartyPopup = () => {
    if (!showPopupFor) return null;
    const { cookieId, email } = showPopupFor;
    const pd = partyPopup[cookieId];

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
        onClick={() => setShowPopupFor(null)}
      >
        <div style={{
          background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 500,
          maxHeight: '75vh', overflowY: 'auto', padding: '20px 16px',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.15)',
        }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={18} color="#A78BFA" />
              <span style={{ fontSize: 16, fontWeight: 700, color: '#1E1B4B' }}>파티 정보</span>
            </div>
            <button onClick={() => setShowPopupFor(null)} style={{
              background: '#F3F0FF', border: 'none', borderRadius: 8,
              padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <X size={16} color="#7C3AED" />
            </button>
          </div>

          <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>{email}</div>

          {pd?.loading && (
            <div style={{ textAlign: 'center', padding: '30px 0', color: '#A78BFA' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', display: 'block' }} />
              <div style={{ fontSize: 13 }}>파티 정보 로딩 중...</div>
            </div>
          )}

          {pd?.error && (
            <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '12px 14px', fontSize: 12, color: '#EF4444' }}>
              {pd.error}
            </div>
          )}

          {pd?.data && (() => {
            const allAccounts: PartyAccount[] = [];
            for (const svc of pd.data.services) {
              for (const acct of svc.accounts) {
                allAccounts.push(acct);
              }
            }

            if (allAccounts.length === 0) {
              return <div style={{ textAlign: 'center', padding: '20px 0', color: '#9CA3AF', fontSize: 13 }}>파티 정보를 찾을 수 없어요</div>;
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {allAccounts.map((acct, ai) => {
                  const filledSlots = acct.usingCount;
                  const totalSlots = Math.max(acct.totalSlots, filledSlots, 1);
                  const emptySlots = Math.max(0, totalSlots - filledSlots);
                  const maxRemain = Math.max(0, ...acct.members.map(m => m.remainderDays || 0));

                  let earliest: string | null = null;
                  let latest: string | null = null;
                  for (const m of acct.members) {
                    if (m.startDateTime && (!earliest || m.startDateTime < earliest)) earliest = m.startDateTime;
                    if (m.endDateTime && (!latest || m.endDateTime > latest)) latest = m.endDateTime;
                  }
                  const totalDays = earliest && latest ? Math.ceil((new Date(latest).getTime() - new Date(earliest).getTime()) / (1000*60*60*24)) : 0;

                  return (
                    <div key={ai} style={{ background: '#F8F6FF', borderRadius: 14, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          {(() => {
                            const cat = CATEGORIES.find(c => c.key === acct.serviceType || c.label === acct.serviceType);
                            return cat ? (
                              <>
                                <img src={cat.logo} alt={cat.label} style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 5, background: cat.bg, padding: 2, flexShrink: 0 }} onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>{cat.label}</span>
                              </>
                            ) : (
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>{acct.serviceType}</span>
                            );
                          })()}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#A78BFA' }}>{fmtMoney(acct.totalIncome)}</div>
                      </div>

                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>{acct.email}</div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                        <div style={{ background: '#fff', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#A78BFA' }}>{filledSlots}/{totalSlots}</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>사용/전체</div>
                        </div>
                        <div style={{ background: '#fff', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: emptySlots > 0 ? '#059669' : '#9CA3AF' }}>{emptySlots}석</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>잔여 자리</div>
                        </div>
                        <div style={{ background: '#fff', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 16, fontWeight: 700, color: maxRemain <= 7 ? '#D97706' : '#1E1B4B' }}>{maxRemain}일</div>
                          <div style={{ fontSize: 10, color: '#9CA3AF' }}>최대 잔여</div>
                        </div>
                      </div>

                      {earliest && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, background: '#fff', borderRadius: 8, padding: '7px 10px' }}>
                          <Calendar size={12} color="#A78BFA" />
                          <span style={{ fontSize: 11, color: '#6B7280' }}>파티 기간:</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#1E1B4B' }}>
                            {fmtDate(earliest)} ~ {fmtDate(latest)}
                            {totalDays > 0 && ` (${totalDays}일)`}
                          </span>
                        </div>
                      )}

                      {acct.expiryDate && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, background: '#fff', borderRadius: 8, padding: '7px 10px' }}>
                          <Clock size={12} color="#D97706" />
                          <span style={{ fontSize: 11, color: '#6B7280' }}>파티 종료:</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706' }}>{fmtDate(acct.expiryDate)}</span>
                        </div>
                      )}

                      {acct.members.length > 0 && (
                        <div style={{ borderTop: '1px solid #EDE9FE', paddingTop: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>파티원 ({acct.members.length}명)</div>
                          {acct.members.map((m, mi) => {
                            const b = badge(m.status, m.statusName);
                            return (
                              <div key={m.dealUsid} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                                borderBottom: mi < acct.members.length - 1 ? '1px solid #F3F0FF' : 'none',
                              }}>
                                <div style={{
                                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                                  background: ['Using', 'UsingNearExpiration'].includes(m.status) ? '#A78BFA' : '#E9E4FF',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 10, fontWeight: 700, color: ['Using', 'UsingNearExpiration'].includes(m.status) ? '#fff' : '#9CA3AF',
                                }}>{mi + 1}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1E1B4B' }}>{m.name || '(미확인)'}</span>
                                    <span style={{ fontSize: 9, fontWeight: 600, color: b.color, background: b.bg, borderRadius: 4, padding: '1px 5px' }}>{b.label}</span>
                                  </div>
                                  {m.remainderDays > 0 && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{m.remainderDays}일 남음</div>}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', flexShrink: 0 }}>{m.price}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          <div style={{ height: 20 }} />
        </div>
      </div>
    );
  };

  // 계정 카드 렌더 함수 (자동/수동 공용)
  const renderAccountCard = (cs: CookieSet | null, id: string, label: string, isAuto: boolean) => {
    const r = results[id];
    const tab = tabs[id] || 'lender';
    const deals = tab === 'borrower' ? r?.data?.borrowerDeals : r?.data?.lenderDeals;
    return (
      <div key={id} style={{ background:'#fff', borderRadius:16, boxShadow:'0 2px 12px rgba(167,139,250,0.08)', border:`1.5px solid ${isAuto ? '#A78BFA' : r?.data ? '#A78BFA' : '#F3F0FF'}`, overflow:'hidden' }}>
        <div style={{ padding:'14px 16px', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:12, background: isAuto ? 'linear-gradient(135deg, #A78BFA, #6D28D9)' : '#EDE9FE', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {isAuto ? <Zap size={20} color="#fff" strokeWidth={2} /> : <Cookie size={20} color="#A78BFA" strokeWidth={2} />}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#1E1B4B' }}>{label}</div>
              {isAuto && (
                <span style={{ fontSize:9, fontWeight:700, color:'#fff', background: autoSession.valid ? '#059669' : '#D97706', borderRadius:4, padding:'1px 6px' }}>
                  {autoSession.loading ? '확인 중' : autoSession.valid ? '활성' : '만료'}
                </span>
              )}
            </div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>
              {isAuto ? '세션 키퍼 자동 관리' : cs!.JSESSIONID.slice(0,18)+'...'}
            </div>
          </div>
          <div style={{ display:'flex', gap:6, flexShrink:0 }}>
            <button onClick={() => query(cs, id)} disabled={r?.loading || (isAuto && !autoSession.valid && !autoSession.loading)} style={{ background:'#EDE9FE', border:'none', borderRadius:8, padding:'6px 12px', fontSize:12, color:'#7C3AED', cursor:r?.loading?'not-allowed':'pointer', fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', gap:5, opacity:r?.loading?0.6:1 }}>
              {r?.loading ? <Loader2 size={13} style={{ animation:'spin 1s linear infinite' }} /> : <Search size={13} />}
              {r?.loading ? '조회중' : '조회'}
            </button>
            {!isAuto && (
              <button onClick={() => del(cs!.id)} style={{ background:'#FFF0F0', border:'none', borderRadius:8, padding:'6px 10px', fontSize:12, color:'#EF4444', cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center' }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {r && (
          <div style={{ borderTop:'1px solid #F3F0FF' }}>
            {r.loading && (
              <div style={{ padding:16, textAlign:'center', color:'#A78BFA', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                <Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> 파티 거래 조회 중...
              </div>
            )}
            {r.error && (
              <div style={{ padding:'12px 16px' }}>
                <div style={{ background:'#FFF0F0', borderRadius:12, padding:'12px 14px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:700, color:'#EF4444', marginBottom:4 }}>
                    <AlertCircle size={15} /> {r.code === 'COOKIE_EXPIRED' ? '쿠키 만료' : '오류'}
                  </div>
                  <div style={{ fontSize:12, color:'#6B7280', lineHeight:1.6 }}>{r.error}</div>
                  {r.code === 'COOKIE_EXPIRED' && isAuto && (
                    <div style={{ fontSize:11, color:'#9CA3AF', marginTop:6 }}>세션 키퍼가 자동 갱신할 때까지 잠시 기다려주세요.</div>
                  )}
                  {r.code === 'COOKIE_EXPIRED' && !isAuto && (
                    <a href="https://graytag.co.kr/login" target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:8, fontSize:12, color:'#7C3AED', fontWeight:600 }}>
                      graytag.co.kr 로그인 <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>
            )}
            {!r.loading && !r.error && r.data && (
              <div style={{ padding:'12px 16px' }}>
                <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                  {(['lender','borrower'] as const).map(t => (
                    <button key={t} onClick={() => setTabs(v=>({...v,[id]:t}))} style={{ flex:1, padding:'8px', borderRadius:10, border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', background: tab===t ? '#A78BFA' : '#F3F0FF', color: tab===t ? '#fff' : '#6B7280' }}>
                      {t==='lender' ? `판매한 파티 (${r.data!.totalLender})` : `구매한 파티 (${r.data!.totalBorrower})`}
                    </button>
                  ))}
                </div>

                {tab === 'lender' && r.data!.totalLender > 0 && (
                  <button
                    onClick={() => loadPartyInfo(cs, id, label)}
                    style={{
                      width: '100%', background: '#F8F6FF', border: '1.5px solid #EDE9FE',
                      borderRadius: 10, padding: '10px', marginBottom: 12, cursor: 'pointer',
                      fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                  >
                    <Users size={14} color="#A78BFA" />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#7C3AED' }}>파티원 · 파티 정보 보기</span>
                    <ChevronRight size={14} color="#A78BFA" />
                  </button>
                )}

                {(!deals || deals.length === 0) ? (
                  <div style={{ textAlign:'center', padding:'20px 0', color:'#9CA3AF', fontSize:13 }}>진행 중인 거래가 없어요</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {deals.map((d: Deal) => {
                      const b = badge(d.dealStatus, d.dealStatusName);
                      return (
                        <div key={d.dealUsid} style={{ background:'#F8F6FF', borderRadius:12, padding:'12px 14px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:700, color:'#1E1B4B' }}>{d.productType}</div>
                              {d.productName && <div style={{ fontSize:11, color:'#6B7280', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.productName}</div>}
                              <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>
                                {tab==='lender' ? '파티원' : '파티장'}: {d.counterpartName||'미확인'}
                                {d.remainderDays > 0 && <span> · {d.remainderDays}일 남음</span>}
                              </div>
                            </div>
                            <div style={{ textAlign:'right', flexShrink:0 }}>
                              <span style={{ display:'inline-block', fontSize:11, fontWeight:600, color:b.color, background:b.bg, borderRadius:6, padding:'3px 8px', marginBottom:4 }}>{b.label}</span>
                              <div style={{ fontSize:14, fontWeight:700, color:'#A78BFA' }}>{d.price}</div>
                            </div>
                          </div>
                          {d.endDateTime && <div style={{ fontSize:11, color:'#C4B5FD', marginTop:6 }}>만료: {new Date(d.endDateTime).toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>내 계정</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>쿠키 기반 파티 거래 조회</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)} style={{ background: showAdd ? '#EDE9FE' : '#A78BFA', border: 'none', borderRadius: 12, padding: '8px 14px', fontSize: 13, color: showAdd ? '#7C3AED' : '#fff', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
          {showAdd ? <X size={14} /> : <Plus size={14} />} {showAdd ? '닫기' : '추가'}
        </button>
      </div>

      {/* 추가 폼 */}
      {showAdd && (
        <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: '0 4px 20px rgba(167,139,250,0.15)', border: '1.5px solid #EDE9FE', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B', marginBottom: 14 }}>계정 추가</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['json','manual'] as const).map(m => (
              <button key={m} onClick={() => setInputMode(m)} style={{ flex:1, padding:8, borderRadius:10, border:'none', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, background: inputMode===m ? '#A78BFA' : '#F3F0FF', color: inputMode===m ? '#fff' : '#6B7280' }}>
                {m === 'json' ? <><ClipboardList size={13} /> JSON 붙여넣기</> : <><Pencil size={13} /> 직접 입력</>}
              </button>
            ))}
          </div>
          <input placeholder="계정 별명 (선택)" value={form.label} onChange={e => setForm(f=>({...f,label:e.target.value}))} style={inp} />
          {inputMode === 'json' ? (
            <>
              <textarea placeholder={'EditThisCookie JSON 붙여넣기\n[{"name":"JSESSIONID","value":"..."},...]'} value={jsonInput} onChange={e => setJsonInput(e.target.value)} style={{ ...inp, height:110, resize:'vertical', fontFamily:'monospace', fontSize:11 }} />
              <button onClick={parseJson} style={{ width:'100%', background:'#EDE9FE', border:'none', borderRadius:10, padding:'10px', fontSize:13, color:'#7C3AED', fontWeight:600, cursor:'pointer', fontFamily:'inherit', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <Search size={14} /> JSON 파싱하기
              </button>
              {form.JSESSIONID && (
                <div style={{ background:'#F0FDF4', borderRadius:10, padding:'10px 12px', marginBottom:8, display:'flex', alignItems:'center', gap:8, fontSize:12 }}>
                  <CheckCircle2 size={14} color="#059669" />
                  <span style={{ color:'#059669', fontWeight:700 }}>파싱 완료</span>
                  <span style={{ color:'#9CA3AF' }}>{form.JSESSIONID.slice(0,20)}...</span>
                </div>
              )}
            </>
          ) : (
            <>
              <input placeholder="JSESSIONID *" value={form.JSESSIONID} onChange={e => setForm(f=>({...f,JSESSIONID:e.target.value}))} style={inp} />
              <input placeholder="AWSALB (선택)" value={form.AWSALB} onChange={e => setForm(f=>({...f,AWSALB:e.target.value}))} style={inp} />
              <input placeholder="AWSALBCORS (선택)" value={form.AWSALBCORS} onChange={e => setForm(f=>({...f,AWSALBCORS:e.target.value}))} style={inp} />
            </>
          )}
          <button onClick={addCookie} disabled={!form.JSESSIONID.trim()} style={{ width:'100%', padding:13, borderRadius:12, border:'none', background: form.JSESSIONID ? '#A78BFA' : '#E9E4FF', color: form.JSESSIONID ? '#fff' : '#9CA3AF', fontWeight:700, fontSize:14, cursor: form.JSESSIONID ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>
            계정 저장
          </button>
        </div>
      )}

      {/* 계정 카드 목록 */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {/* 자동 쿠키 (Session Keeper) 카드 - 항상 맨 위 */}
        {renderAccountCard(null, AUTO_COOKIE_ID, '자동 (Session Keeper)', true)}

        {/* 수동 쿠키 카드들 */}
        {cookies.map(cs => renderAccountCard(cs, cs.id, cs.label, false))}
      </div>
      <div style={{ height:20 }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 파티 정보 팝업 */}
      {renderPartyPopup()}
    </div>
  );
}

const inp: React.CSSProperties = { width:'100%', padding:'11px 14px', borderRadius:10, border:'1.5px solid #EDE9FE', fontSize:13, color:'#1E1B4B', background:'#F8F6FF', outline:'none', fontFamily:'inherit', marginBottom:8, boxSizing:'border-box' };
