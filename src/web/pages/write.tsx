import { useState, useEffect, useRef } from "react";
import { KeyRound, PartyPopper, CheckCircle2, KeySquare, Loader2, AlertTriangle, Trophy, Info, PenLine, Check, X, Square, Clock, ArrowLeftRight, Type, Mail, Link } from "lucide-react";

interface SlAlias { id: number; email: string; enabled: boolean; nb_forward: number; pin?: string | null; hasPin?: boolean; }

const AUTO_COOKIE_ID = '__session_keeper__';
const AUTO_COOKIE: CookieSet = { id: AUTO_COOKIE_ID, label: '자동 (Session Keeper)', AWSALB: '', AWSALBCORS: '', JSESSIONID: '__auto__' };
const STORAGE_KEY = 'graytag_cookies_v2';
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => { try { return [AUTO_COOKIE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')]; } catch { return [AUTO_COOKIE]; } };

const DEFAULT_SERVICE_KEY = 'disney';
const SERVICES = [
  { key: 'wavve',   label: '웨이브',       category: 'wavve',     color: '#006BE9', bg: '#EEF5FF', logo: '/logos/wavve.png' },
  { key: 'disney',  label: '디즈니플러스', category: 'disney',    color: '#1A3E8C', bg: '#EEF3FF', logo: '/logos/disney.png' },
  { key: 'watcha',  label: '왓챠플레이',   category: 'WatchaPlay', color: '#FF153C', bg: '#FFF0F3', logo: '/logos/watcha.png' },
  { key: 'netflix', label: '넷플릭스',    category: 'Netflix',   color: '#E50914', bg: '#FFF0F0', logo: '/logos/netflix.png' },
  { key: 'tving',   label: '티빙',        category: 'tving',     color: '#FF153C', bg: '#FFF0F3', logo: '/logos/tving.png' },
];
const DEFAULT_SVC_LABEL = SERVICES.find(s => s.key === DEFAULT_SERVICE_KEY)?.label || SERVICES[0].label;

type Step = 'form' | 'progress' | 'keepAcct' | 'done';
type PriceMode = 'total' | 'daily';

interface ProgressItem {
  index: number;
  status: 'pending' | 'running' | 'done' | 'error';
  productUsid?: string;
  error?: string;
}

interface PriceRank {
  rank: number;
  pricePerDayNum: number;
  total: number;
}

const makeDefaultTitle = (svcLabel: string) => `✅ 이메일 코드 언제든지 셀프인증 가능! ✅ ${svcLabel} 프리미엄!`;

export default function WritePage() {
  const cookies = loadCookies();
  const [selectedId, setSelectedId] = useState(cookies[0]?.id || '');
  const [step, setStep] = useState<Step>('form');

  // 폼
  const [service, setService] = useState(DEFAULT_SERVICE_KEY);
  const [endDate, setEndDate] = useState('');
  const [price, setPrice] = useState('');
  const [dailyPrice, setDailyPrice] = useState('');
  const [priceMode, setPriceMode] = useState<PriceMode>('total');
  const [repeat, setRepeat] = useState(1);
  const [title, setTitle] = useState(() => makeDefaultTitle(DEFAULT_SVC_LABEL));

  const makeDefaultDesc = (svcLabel: string) => `✅ 이메일 코드 언제든지 셀프인증 가능! ✅ ${svcLabel} 프리미엄!\n구매 시 제공되는 "직접 운영하는" 이메일 코드 확인 사이트를 통해 언제든지 이메일을 확인하실 수 있으십니다!\n\n❤️ 1 1 1 원칙을 꼭 지켜주세요 ❤️\n1인 1기기 1계정 원칙이며 어길 시 약정에 의거 위약금 부과됩니다!`;

  const makeDefaultKeepMemo = (emailId?: number|string, pin?: string) => {
    const eid = emailId || '{EMAIL_ID}';
    const p = pin || '{PIN}';
    return `아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!!\n로그인 시도 간 필요한 이메일 코드는 아래 사이트에서 언제든지 셀프인증 가능합니다!\nhttps://email-verify.xyz/email/mail/${eid}\n사이트에서 필요한 핀번호는 : ${p}입니다!\n\n프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!\n만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다! 예)홍길동 또는 홍*동\n만약, 접속 시 기본 프로필 1개만  있거나 자리가 꽉 찼는데 기본 프로필이 있다면 그걸 먼저 수정하고 사용하시면 되겠습니다!\n\n🎬 성인인증은 필요하시면 직접 하셔야 합니다! 🎬\n\n즐거운 시청되세요!`;
  };

  const [description, setDescription] = useState(() => makeDefaultDesc(DEFAULT_SVC_LABEL));

  // 계정 전달
  const [keepAcct, setKeepAcct] = useState('');
  const [keepPasswd, setKeepPasswd] = useState('');
  const [keepMemo, setKeepMemo] = useState(() => makeDefaultKeepMemo());
  const [slAliases, setSlAliases] = useState<SlAlias[]>([]);
  const [slLoading, setSlLoading] = useState(false);
  const [selectedAliasId, setSelectedAliasId] = useState<number | null>(null);
  const [keepPin, setKeepPin] = useState('');

  // 진행 상태
  const [progressList, setProgressList] = useState<ProgressItem[]>([]);
  const [doneProductUsids, setDoneProductUsids] = useState<string[]>([]);

  // 실시간 순위 (일당 가격 기준)
  const [priceInfo, setPriceInfo] = useState<PriceRank | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const priceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 남은 일수 계산
  const calcDays = () => {
    if (!endDate) return 0;
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date(endDate);
    return Math.ceil((end.getTime() - today.getTime()) / (1000*60*60*24));
  };

  // 총 금액에서 일당 계산
  const calcDailyFromTotal = () => {
    const p = parseInt(price.replace(/,/g, '')) || 0;
    const days = calcDays();
    if (days <= 0 || p <= 0) return null;
    return { daily: Math.ceil(p / days), days, total: p };
  };

  // 일당에서 총 금액 계산
  const calcTotalFromDaily = () => {
    const d = parseInt(dailyPrice.replace(/,/g, '')) || 0;
    const days = calcDays();
    if (days <= 0 || d <= 0) return null;
    return { daily: d, days, total: d * days };
  };

  const calcInfo = priceMode === 'total' ? calcDailyFromTotal() : calcTotalFromDaily();
  const finalTotalPrice = priceMode === 'total'
    ? (parseInt(price.replace(/,/g, '')) || 0)
    : (calcInfo?.total || 0);
  const finalDailyPrice = calcInfo?.daily || 0;

  // 모드 전환
  const togglePriceMode = () => {
    if (priceMode === 'total') {
      const info = calcDailyFromTotal();
      if (info) setDailyPrice(info.daily.toLocaleString());
      setPriceMode('daily');
    } else {
      const info = calcTotalFromDaily();
      if (info) setPrice(info.total.toLocaleString());
      setPriceMode('total');
    }
  };

  // ★ 순위 실시간 조회 — 일당 가격(pricePerDayNum) 기준으로 비교
  useEffect(() => {
    if (!calcInfo) { setPriceInfo(null); return; }
    if (priceTimer.current) clearTimeout(priceTimer.current);
    priceTimer.current = setTimeout(async () => {
      setPriceLoading(true);
      try {
        const res = await fetch(`/api/prices/${service}`);
        const json = await res.json() as any;
        const products: any[] = json.products || [];
        // 일당 가격 기준 순위: 내 일당가보다 낮은(저렴한) 상품 수 + 1
        const myDaily = calcInfo.daily;
        const cheaper = products.filter((p: any) => p.pricePerDayNum < myDaily).length;
        setPriceInfo({ rank: cheaper + 1, pricePerDayNum: myDaily, total: json.count || products.length });
      } catch { setPriceInfo(null); }
      finally { setPriceLoading(false); }
    }, 500);
    return () => { if (priceTimer.current) clearTimeout(priceTimer.current); };
  }, [price, dailyPrice, endDate, service, priceMode]);

  const toGraytagDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}${m}${day}T2359`;
  };

  const tomorrow = () => {
    const d = new Date(); d.setDate(d.getDate()+1);
    return d.toISOString().split('T')[0];
  };

  // 등록 실행
  const handleSubmit = async () => {
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) { setError('계정을 선택해주세요'); return; }
    if (!endDate) { setError('종료일을 입력해주세요'); return; }
    if (finalTotalPrice < 1000) { setError('가격은 최소 1,000원입니다'); return; }
    if (!title.trim()) { setError('제목을 입력해주세요'); return; }
    if (!description.trim()) { setError('상품 설명을 입력해주세요'); return; }

    const count = Math.max(1, Math.min(repeat, 20));
    const initial: ProgressItem[] = Array.from({length: count}, (_, i) => ({ index: i+1, status: 'pending' }));
    setProgressList(initial);
    setDoneProductUsids([]);
    setStep('progress');
    setError(null);

    const svc = SERVICES.find(s => s.key === service)!;
    const productModel = {
      tempProductCategory: svc.category,
      endDate: toGraytagDate(endDate),
      priceType: 'Normal',
      price: String(finalTotalPrice),
      name: title,
      sellingGuide: description,
      ...(service === 'netflix' ? { netflixSeatCount: '5', productCountryString: 'Domestic' } : {}),
    };

    const results: string[] = [];

    for (let i = 0; i < count; i++) {
      setProgressList(prev => prev.map(p => p.index === i+1 ? { ...p, status: 'running' } : p));

      try {
        const res = await fetch('/api/post/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }), productModel }),
        });
        const json = await res.json() as any;
        if (!res.ok || !json.productUsid) throw new Error(json.error || '등록 실패');

        results.push(json.productUsid);
        setProgressList(prev => prev.map(p => p.index === i+1 ? { ...p, status: 'done', productUsid: json.productUsid } : p));
      } catch (e: any) {
        setProgressList(prev => prev.map(p => p.index === i+1 ? { ...p, status: 'error', error: e.message } : p));
      }

      if (i < count - 1) await new Promise(r => setTimeout(r, 800));
    }

    setDoneProductUsids(results);
    if (results.length > 0) {
      // 이메일 별칭 목록 미리 로드
      setSlLoading(true);
      try {
        const aliasRes = await fetch('/api/sl/aliases');
        if (!aliasRes.ok) throw new Error('fetch failed'); const aliasJson = await aliasRes.json() as any;
        setSlAliases((aliasJson.aliases || []).filter((a: SlAlias) => a.enabled));
      } catch {}
      setSlLoading(false);
      setTimeout(() => setStep('keepAcct'), 500);
    }
  };

  // 계정 전달 일괄 설정
  const handleKeepAcct = async () => {
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) return;
    if (!keepAcct.trim() || !keepPasswd.trim()) { setError('아이디와 비밀번호를 입력해주세요'); return; }

    setSubmitting(true); setError(null);
    let successCount = 0;
    for (const usid of doneProductUsids) {
      try {
        const res = await fetch('/api/post/keepAcct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }), productUsid: usid, keepAcct, keepPasswd, keepMemo }),
        });
        if (res.ok) successCount++;
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
    setSubmitting(false);
    if (successCount > 0) setStep('done');
    else setError('계정 전달 설정에 실패했어요. 나중에 직접 설정해주세요.');
  };

  const reset = () => {
    setStep('form'); setProgressList([]); setDoneProductUsids([]);
    setPrice(''); setDailyPrice(''); setEndDate(''); setRepeat(1); setError(null);
    setService(DEFAULT_SERVICE_KEY); setPriceMode('total');
    setTitle(makeDefaultTitle(DEFAULT_SVC_LABEL));
    setDescription(makeDefaultDesc(DEFAULT_SVC_LABEL));
    setKeepAcct(''); setKeepPasswd('');
    setKeepMemo(makeDefaultKeepMemo());
    setKeepPin(''); setSelectedAliasId(null); setSlAliases([]);
  };

  // ── 쿠키 없음 ──────────────────────────────────────────────
  // 자동 쿠키가 항상 있으므로 빈 상태 가드 제거됨

  // ── 완료 ────────────────────────────────────────────────────
  if (step === 'done') {
    const successItems = progressList.filter(p => p.status === 'done');
    return (
      <div style={{ padding: '20px 16px' }}>
        <div style={{ background: '#fff', borderRadius: 20, padding: 28, textAlign: 'center', boxShadow: '0 4px 20px rgba(167,139,250,0.15)' }}>
          <PartyPopper size={48} color="#A78BFA" style={{ margin:"0 auto 12px", display:"block" }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1E1B4B', marginBottom: 6 }}>등록 완료!</div>
          <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>
            {successItems.length}개 파티 판매 글이 등록됐어요
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {successItems.map(item => (
              <a key={item.productUsid}
                href={`https://graytag.co.kr/product/detail?productUsid=${item.productUsid}`}
                target="_blank" rel="noreferrer"
                style={{ background: '#F8F6FF', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#7C3AED', fontWeight: 600, textDecoration: 'none', textAlign: 'left' }}>
                #{item.index} 상품 보기 →
              </a>
            ))}
          </div>
          <button onClick={reset} style={{ width: '100%', ...btnStyle('#A78BFA', '#fff') }}>새 글 작성</button>
        </div>
      </div>
    );
  }

  // ── 계정 전달 ────────────────────────────────────────────────

  // === keepAcct 단계: 계정 전달 안내 ===
  // 참고: makeDefaultKeepMemo()는 {EMAIL_ID}, {PIN}을 포함하며,
  // 실제 email 서비스와 연동 시 다음과 같이 수정:
  // const memo = makeDefaultKeepMemo(emailId, pin);

  if (step === 'keepAcct') {
    const successCount = doneProductUsids.length;

    // 이메일 별칭 선택 핸들러
    const handleSelectAlias = (alias: SlAlias) => {
      setSelectedAliasId(alias.id);
      setKeepAcct(alias.email);
      // PIN: API 응답 → localStorage(sl_alias_pin_{id}) → 수동 입력값 순으로 폴백
      const lsPin = (() => { try { return localStorage.getItem(`sl_alias_pin_${alias.id}`) || ''; } catch { return ''; } })();
      const autoPin = alias.pin || lsPin || keepPin.trim();
      if (autoPin) {
        setKeepPin(autoPin);
        setKeepMemo(makeDefaultKeepMemo(alias.id, autoPin));
      } else {
        setKeepMemo(makeDefaultKeepMemo(alias.id));
      }
    };

    // PIN 변경 시 keepMemo 자동 갱신
    const handlePinChange = (newPin: string) => {
      setKeepPin(newPin);
      if (selectedAliasId && newPin.trim()) {
        setKeepMemo(makeDefaultKeepMemo(selectedAliasId, newPin.trim()));
      } else if (selectedAliasId) {
        setKeepMemo(makeDefaultKeepMemo(selectedAliasId));
      }
    };

    return (
      <div style={{ padding: '20px 16px 0' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>✍️ 계정 자동 전달</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>구매자에게 자동으로 계정 정보를 전달해요</p>
        </div>

        <div style={{ background: '#F0FDF4', borderRadius: 14, padding: '12px 16px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          <CheckCircle2 size={20} color="#059669" strokeWidth={2.5} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#059669' }}>{successCount}개 글 등록 완료</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>동일한 계정 정보로 {successCount}개 상품에 일괄 설정돼요</div>
          </div>
        </div>

        {error && <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#EF4444' }}>{error}</div>}

        {/* 이메일 별칭 선택 */}
        {slAliases.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 16, border: '1.5px solid #EDE9FE', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link size={14} color="#A78BFA" /> 이메일 연동 (클릭하여 선택)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {slAliases.map(alias => {
                const lsPin = (() => { try { return localStorage.getItem(`sl_alias_pin_${alias.id}`) || ''; } catch { return ''; } })();
                const displayPin = alias.pin || lsPin;
                return (
                <button key={alias.id} onClick={() => handleSelectAlias(alias)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, border: `1.5px solid ${selectedAliasId === alias.id ? '#A78BFA' : '#EDE9FE'}`,
                  background: selectedAliasId === alias.id ? '#F5F3FF' : '#F8F6FF',
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
                }}>
                  <Mail size={14} color={selectedAliasId === alias.id ? '#A78BFA' : '#9CA3AF'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: selectedAliasId === alias.id ? '#7C3AED' : '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {alias.email}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                      <span style={{ fontSize: 10, color: '#9CA3AF' }}>ID: {alias.id}</span>
                      {displayPin
                        ? <span style={{ fontSize: 9, fontWeight: 700, color: '#059669', background: '#F0FDF4', borderRadius: 4, padding: '1px 5px' }}>PIN: {displayPin}</span>
                        : <span style={{ fontSize: 9, color: '#D97706', background: '#FFFBEB', borderRadius: 4, padding: '1px 5px' }}>PIN 미확인</span>
                      }
                    </div>
                  </div>
                  {selectedAliasId === alias.id && <Check size={14} color="#A78BFA" strokeWidth={3} />}
                </button>
                );
              })}
            </div>
          </div>
        )}
        {slLoading && <div style={{ fontSize: 12, color: '#C4B5FD', marginBottom: 12 }}>이메일 목록 로딩 중...</div>}

        <div style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1.5px solid #EDE9FE', boxShadow: '0 2px 12px rgba(167,139,250,0.08)', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B', marginBottom: 14, display:"flex", alignItems:"center", gap:8 }}><KeySquare size={16} color="#A78BFA" /> 계정 정보</div>
          <label style={labelStyle}>아이디 (이메일) *</label>
          <input value={keepAcct} onChange={e => setKeepAcct(e.target.value)} placeholder="example@email.com" style={inputStyle} />
          <label style={labelStyle}>비밀번호 *</label>
          <input value={keepPasswd} onChange={e => setKeepPasswd(e.target.value)} placeholder="비밀번호" style={inputStyle} />

          {/* PIN 입력 */}
          <label style={labelStyle}>셀프인증 핀번호</label>
          <input value={keepPin} onChange={e => handlePinChange(e.target.value)} placeholder="예: 1234" style={inputStyle} />
          {selectedAliasId && keepPin && (
            <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '8px 10px', marginTop: -4, marginBottom: 10, fontSize: 11, color: '#059669', display: 'flex', alignItems: 'center', gap: 5 }}>
              <CheckCircle2 size={12} /> 인증 링크 자동 생성됨
            </div>
          )}

          <label style={labelStyle}>추가 안내</label>
          <textarea value={keepMemo} onChange={e => setKeepMemo(e.target.value)}
            placeholder={'이메일 및 로그인 관련 안내가 기본값으로 포함됩니다'}
            style={{ ...inputStyle, height: 120, resize: 'vertical', fontSize: 12 }} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setStep('done')} style={{ flex: 1, ...btnStyle('#F3F0FF', '#7C3AED'), fontSize: 13 }}>나중에 설정</button>
          <button onClick={handleKeepAcct} disabled={submitting} style={{ flex: 2, ...btnStyle(submitting ? '#C4B5FD' : '#A78BFA', '#fff'), opacity: submitting ? 0.8 : 1 }}>
            {submitting ? `설정 중 (${doneProductUsids.length}개)...` : `${successCount}개 일괄 설정`}
          </button>
        </div>
        <div style={{ height: 20 }} />
      </div>
    );
  }

  // ── 진행 중 ──────────────────────────────────────────────────
  if (step === 'progress') {
    const done = progressList.filter(p => p.status === 'done').length;
    const errors = progressList.filter(p => p.status === 'error').length;
    const total = progressList.length;
    const pct = Math.round((done + errors) / total * 100);

    return (
      <div style={{ padding: '20px 16px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: '0 0 16px', display:"flex", alignItems:"center", gap:10 }}><Loader2 size={22} color="#A78BFA" style={{ animation:"spin 1s linear infinite" }} /> 등록 중...</h1>

        <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 14, border: '1.5px solid #EDE9FE' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
            <span>{done}/{total} 완료</span>
            <span>{pct}%</span>
          </div>
          <div style={{ background: '#EDE9FE', borderRadius: 8, height: 8, overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(90deg, #A78BFA, #818CF8)', height: '100%', width: `${pct}%`, borderRadius: 8, transition: 'width 0.4s ease' }} />
          </div>
          {errors > 0 && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 6, display:'flex', alignItems:'center', gap:4 }}><AlertTriangle size={11} />{errors}개 실패</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {progressList.map(item => (
            <div key={item.index} style={{
              background: '#fff', borderRadius: 12, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
              border: `1.5px solid ${item.status === 'done' ? '#A7F3D0' : item.status === 'error' ? '#FCA5A5' : item.status === 'running' ? '#A78BFA' : '#F3F0FF'}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                background: item.status === 'done' ? '#F0FDF4' : item.status === 'error' ? '#FFF0F0' : item.status === 'running' ? '#EDE9FE' : '#F8F6FF',
              }}>
                {item.status === 'done' ? <Check size={16} color='#059669' strokeWidth={3} /> : item.status === 'error' ? <X size={16} color='#EF4444' strokeWidth={3} /> : item.status === 'running' ? <Loader2 size={16} color='#A78BFA' style={{ animation:'spin 1s linear infinite' }} /> : <Square size={16} color='#C4B5FD' />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B' }}>
                  #{item.index} 상품 {item.status === 'running' ? '등록 중...' : item.status === 'done' ? '등록 완료' : item.status === 'error' ? '실패' : '대기 중'}
                </div>
                {item.error && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 2 }}>{item.error}</div>}
                {item.productUsid && (
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{item.productUsid}</div>
                )}
              </div>
              {item.status === 'running' && (
                <div style={{ width: 18, height: 18, border: '2px solid #EDE9FE', borderTop: '2px solid #A78BFA', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ height: 20 }} />
      </div>
    );
  }

  // ── 메인 폼 ──────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 16px 0' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>✍️ 글 작성</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>graytag 파티 판매 글 등록</p>
      </div>

      {/* 계정 선택 */}
      {cookies.length > 1 && (
        <div className="no-scrollbar" style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' }}>
          {cookies.map(cs => (
            <button key={cs.id} onClick={() => setSelectedId(cs.id)} style={{
              flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: selectedId === cs.id ? '#A78BFA' : '#fff',
              color: selectedId === cs.id ? '#fff' : '#6B7280',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>🍪 {cs.label}</button>
          ))}
        </div>
      )}

      {error && <div style={{ background: '#FFF0F0', borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#EF4444' }}>{error}</div>}

      {/* ① 서비스 선택 */}
      <div style={card}>
        <label style={labelStyle}>서비스 *</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {SERVICES.map(s => (
            <button key={s.key} onClick={() => {
              setService(s.key);
              // 제목이 기본값이면 서비스명 교체
              setTitle(prev => {
                const prevLabel = SERVICES.find(sv => sv.key === service)?.label || '';
                if (prev === makeDefaultTitle(prevLabel)) return makeDefaultTitle(s.label);
                return prev;
              });
              setDescription(prev => {
                const prevLabel = SERVICES.find(sv => sv.key === service)?.label || '';
                if (prev === makeDefaultDesc(prevLabel)) return makeDefaultDesc(s.label);
                return prev;
              });
            }} style={{
              padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit',
              background: service === s.key ? s.bg : '#F8F8F8',
              border: `2px solid ${service === s.key ? s.color : 'transparent'}`,
            }}>
              <img src={s.logo} alt={s.label}
                style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }}
                onError={e => { (e.target as HTMLImageElement).style.display='none'; }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: service === s.key ? s.color : '#6B7280' }}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ② 제목 */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Type size={12} color="#A78BFA" /> 상품 제목 *
          </label>
          <button onClick={() => setTitle(makeDefaultTitle(SERVICES.find(s => s.key === service)?.label || ''))} style={{
            background: '#EDE9FE', border: 'none', borderRadius: 8, padding: '3px 8px',
            fontSize: 10, color: '#7C3AED', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>기본값</button>
        </div>
        <input type="text" value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="상품 제목을 입력하세요" style={inputStyle} />
        <div style={{ fontSize: 10, color: '#C4B5FD', textAlign: 'right', marginTop: -6 }}>{title.length}자</div>
      </div>

      {/* ③ 기간 + 가격 */}
      <div style={card}>
        <label style={labelStyle}>상품 종료일 *</label>
        <input type="date" value={endDate} min={tomorrow()}
          onChange={e => setEndDate(e.target.value)} style={inputStyle} />

        {/* 가격 모드 토글 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            {priceMode === 'total' ? '총 판매 가격 (원) *' : '일당 가격 (원) *'}
          </label>
          <button onClick={togglePriceMode} style={{
            background: '#EDE9FE', border: 'none', borderRadius: 8, padding: '4px 10px',
            fontSize: 11, color: '#7C3AED', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <ArrowLeftRight size={11} />
            {priceMode === 'total' ? '일당으로 입력' : '총액으로 입력'}
          </button>
        </div>

        {priceMode === 'total' ? (
          <input type="text" inputMode="numeric" value={price}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9]/g,'');
              setPrice(raw ? Number(raw).toLocaleString() : '');
            }}
            placeholder="예: 4,500" style={inputStyle} />
        ) : (
          <input type="text" inputMode="numeric" value={dailyPrice}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9]/g,'');
              setDailyPrice(raw ? Number(raw).toLocaleString() : '');
            }}
            placeholder="예: 150" style={inputStyle} />
        )}

        {/* 계산 결과 + 순위 (일당 가격 기준) */}
        {(calcInfo || priceLoading) && (
          <div style={{ background: '#F8F6FF', borderRadius: 12, padding: '12px 14px', marginTop: -4 }}>
            {calcInfo && (
              <>
                {priceMode === 'total' ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: priceInfo ? 8 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>일당</span>
                      <span style={{ fontSize: 20, fontWeight: 700, color: '#A78BFA' }}>{calcInfo.daily.toLocaleString()}원</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>{calcInfo.days}일 기준</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: priceInfo ? 8 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>총 금액</span>
                      <span style={{ fontSize: 20, fontWeight: 700, color: '#A78BFA' }}>{calcInfo.total.toLocaleString()}원</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>{calcInfo.days}일 × {calcInfo.daily.toLocaleString()}원</span>
                  </div>
                )}
              </>
            )}
            {priceLoading && <div style={{ fontSize: 11, color: '#C4B5FD' }}>순위 계산 중...</div>}
            {!priceLoading && priceInfo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  padding: '4px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: priceInfo.rank === 1 ? '#A78BFA' : priceInfo.rank <= 3 ? '#C4B5FD' : priceInfo.rank <= 5 ? '#EDE9FE' : '#F3F4F6',
                  color: priceInfo.rank <= 3 ? '#fff' : '#6B7280',
                }}>
                  {priceInfo.rank}위
                </div>
                <span style={{ fontSize: 12, color: '#6B7280' }}>/ {priceInfo.total}개 중</span>
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>(일당가 기준)</span>
                {priceInfo.rank === 1 && <span style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}><Trophy size={12} style={{ marginRight:3 }} />최저가!</span>}
                {priceInfo.rank > 5 && <span style={{ fontSize: 11, color: '#9CA3AF' }}>가격을 낮춰보세요</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ④ 상품 설명 */}
      <div style={card}>
        <label style={labelStyle}>상품 설명 *</label>
        <div style={{ fontSize: 11, color: '#C4B5FD', marginBottom: 6 }}>
          ⚠️ 카톡·전화번호 등 외부 연락처 포함 불가
        </div>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder={'예:\n- 본인 프로필만 접속해 주세요.\n- 여러 기기 동시 접속 불가합니다.\n- 인증 요청 시 채팅방 이용해주세요.'}
          style={{ ...inputStyle, height: 120, resize: 'vertical' }} />
        <div style={{ fontSize: 11, color: '#C4B5FD', textAlign: 'right', marginTop: -6 }}>{description.length}자</div>
      </div>

      {/* ⑤ 반복 횟수 */}
      <div style={card}>
        <label style={labelStyle}>작성 반복 횟수</label>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>
          동일한 내용으로 여러 개 동시 등록 (최대 20개)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setRepeat(r => Math.max(1, r-1))} style={{
            width: 38, height: 38, borderRadius: 10, border: '1.5px solid #EDE9FE',
            background: '#F8F6FF', fontSize: 20, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A78BFA', fontWeight: 700, flexShrink: 0,
          }}>−</button>

          <div style={{ flex: 1, background: '#F8F6FF', borderRadius: 12, border: '1.5px solid #EDE9FE', padding: '10px 0', textAlign: 'center' }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#A78BFA' }}>{repeat}</span>
            <span style={{ fontSize: 13, color: '#9CA3AF', marginLeft: 6 }}>개</span>
          </div>

          <button onClick={() => setRepeat(r => Math.min(20, r+1))} style={{
            width: 38, height: 38, borderRadius: 10, border: '1.5px solid #EDE9FE',
            background: '#F8F6FF', fontSize: 20, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#A78BFA', fontWeight: 700, flexShrink: 0,
          }}>+</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {[1,2,3,5,10].map(n => (
            <button key={n} onClick={() => setRepeat(n)} style={{
              padding: '5px 14px', borderRadius: 20, border: 'none', fontFamily: 'inherit',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: repeat === n ? '#A78BFA' : '#EDE9FE',
              color: repeat === n ? '#fff' : '#7C3AED',
            }}>{n}개</button>
          ))}
        </div>

        {repeat > 1 && (
          <div style={{ marginTop: 10, background: '#EDE9FE', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#7C3AED' }}>
            💡 총 {repeat}개 글이 순차 등록돼요 (약 {Math.ceil(repeat * 0.8 + 1)}초 소요)
          </div>
        )}
      </div>

      {/* 등록 버튼 */}
      <button onClick={handleSubmit} style={{
        width: '100%', background: '#A78BFA', border: 'none', borderRadius: 14,
        padding: 15, fontSize: 15, color: '#fff', fontWeight: 700,
        cursor: 'pointer', fontFamily: 'inherit',
        boxShadow: '0 4px 16px rgba(167,139,250,0.35)',
      }}>
        📝 {repeat > 1 ? `${repeat}개 등록하기` : '글 등록하기'}
        {calcInfo && priceMode === 'daily' && ` (${calcInfo.total.toLocaleString()}원)`}
      </button>

      <div style={{ height: 20 }} />
    </div>
  );
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return { background: bg, border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, color, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', width: '100%' };
}
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
  boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1.5px solid #F3F0FF',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #EDE9FE',
  fontSize: 13, color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
  fontFamily: 'inherit', marginBottom: 10, boxSizing: 'border-box',
};
