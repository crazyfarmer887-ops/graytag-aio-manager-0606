import { useState, useEffect } from "react";
import { CATEGORIES } from "../lib/constants";
import { RefreshCw, Loader2, AlertCircle, Check, CheckSquare, Square, DollarSign, ArrowLeftRight, Trophy, TrendingDown, Trash2, Settings, Zap, Clock, ChevronDown, ChevronUp, FileText, TrendingUp, AlertTriangle, Info } from "lucide-react";

const typeToKey = (type: string) => CATEGORIES.find(c => c.label === type || type.includes(c.label.slice(0, 3)))?.key || '';

// 서비스별 손익분기 일당 (원/일, 수수료 10% 포함)
// 음수 = 추가공유 수입만으로 흑자 (파티원은 무조건 이익)
const BREAKEVEN_DAILY: Record<string, number> = {
  '넷플릭스':    84,
  '디즈니플러스': 81,
  '웨이브':      118,
  '티빙':        -56,  // 추가공유 수입으로 이미 흑자
  '왓챠플레이':  -74,  // 추가공유 수입으로 이미 흑자
  '유튜브':      100,  // 미설정 (기본값)
  '라프텔':      100,
  '쿠팡플레이':  100,
  'AppleOne':   100,
  '프라임비디오': 100,
};

const getBreakevenDaily = (productType: string): number | null => {
  for (const [key, val] of Object.entries(BREAKEVEN_DAILY)) {
    if (productType.includes(key) || key.includes(productType.slice(0, 3))) return val;
  }
  return null;
};

interface MarketInfo {
  lowestDaily: number;
  myRank: number;
  sameCount: number;
  total: number;
  myDaily: number;
}

interface Product {
  productUsid: string;
  productName: string;
  productType: string;
  price: string;
  priceNum: number;
  endDateTime: string;
  remainderDays: number;
  keepAcct: string;
  keepPasswd: string;
}

interface UpdateResult {
  usid: string;
  ok: boolean;
  error?: string;
}

const AUTO_COOKIE_ID = '__session_keeper__';
const AUTO_COOKIE: CookieSet = { id: AUTO_COOKIE_ID, label: '자동 (Session Keeper)', AWSALB: '', AWSALBCORS: '', JSESSIONID: '__auto__' };
const STORAGE_KEY = 'graytag_cookies_v2';
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => { try { return [AUTO_COOKIE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')]; } catch { return [AUTO_COOKIE]; } };

const svcColor = (s: string) => CATEGORIES.find(c => c.label === s || s.includes(c.label.slice(0, 3)));
const fmtMoney = (n: number) => n > 0 ? n.toLocaleString() + '원' : '-';

type PriceMode = 'total' | 'daily';

export default function EditPricePage() {
  const cookies = loadCookies();
  const [selectedId, setSelectedId] = useState(cookies[0]?.id || '');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 선택
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 가격 입력
  const [priceMode, setPriceMode] = useState<PriceMode>('total');
  const [newPrice, setNewPrice] = useState('');
  const [newDailyPrice, setNewDailyPrice] = useState('');

  // 상품 안내 문구
  const [productNameEdit, setProductNameEdit] = useState('');
  const [useProductName, setUseProductName] = useState(false);

  // 업데이트 / 삭제 진행
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [results, setResults] = useState<UpdateResult[] | null>(null);
  const [deleteResults, setDeleteResults] = useState<UpdateResult[] | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 시장 가격 정보 (카테고리별)
  const [marketData, setMarketData] = useState<Record<string, { products: any[]; count: number }>>({});
  const [emailMap, setEmailMap] = useState<Record<string, string>>({});  // productType -> email

  // 일당 가격 자동 동기화
  const [showRateSettings, setShowRateSettings] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);

  // Auto Undercutter 상태
  const [undercutterOn, setUndercutterOn] = useState(() => {
    try { return localStorage.getItem('undercutter_on') === 'true'; } catch { return false; }
  });
  const [undercutterInterval, setUndercutterInterval] = useState(() => {
    try { return parseInt(localStorage.getItem('undercutter_interval') || '5'); } catch { return 5; }
  });
  const [undercutterPreview, setUndercutterPreview] = useState<any>(null);
  const [undercutterResult, setUndercutterResult] = useState<any>(null);
  const [undercutterRunning, setUndercutterRunning] = useState(false);
  const [showUndercutter, setShowUndercutter] = useState(false);
  const [undercutterLastRun, setUndercutterLastRun] = useState<string | null>(null);
  const [undercutterLogs, setUndercutterLogs] = useState<any[]>([]);





  // Auto Undercutter 함수들
  const runUndercutterPreview = async () => {
    setUndercutterRunning(true); setUndercutterPreview(null);
    try {
      const res = await fetch('/api/auto-undercutter/preview');
      setUndercutterPreview(await res.json());
    } catch (e: any) { setUndercutterPreview({ error: e.message }); }
    finally { setUndercutterRunning(false); }
  };

  const runUndercutter = async () => {
    setUndercutterRunning(true); setUndercutterResult(null);
    try {
      const res = await fetch('/api/auto-undercutter/run', { method: 'POST' });
      const json = await res.json();
      setUndercutterResult(json);
      setUndercutterLastRun(new Date().toLocaleTimeString('ko-KR'));
    } catch (e: any) { setUndercutterResult({ error: e.message }); }
    finally { setUndercutterRunning(false); }
  };

  const loadUndercutterLogs = async () => {
    try {
      const res = await fetch('/api/auto-undercutter/log');
      setUndercutterLogs(await res.json());
    } catch {}
  };

  // 서버 상태 로드 (마운트 시)
  useEffect(() => {
    fetch('/api/auto-undercutter/state')
      .then(r => r.json())
      .then((s: any) => {
        if (s && typeof s.on === 'boolean') {
          setUndercutterOn(s.on);
          localStorage.setItem('undercutter_on', String(s.on));
        }
        if (s && s.intervalMinutes) {
          setUndercutterInterval(s.intervalMinutes);
          localStorage.setItem('undercutter_interval', String(s.intervalMinutes));
        }
      })
      .catch(() => {});
  }, []);

  // 폴링 인터벌 (브라우저 탭 열려있을 때 추가 실행) + 서버 상태 동기화
  useEffect(() => {
    localStorage.setItem('undercutter_on', String(undercutterOn));
    localStorage.setItem('undercutter_interval', String(undercutterInterval));
    // 서버에 상태 저장
    fetch('/api/auto-undercutter/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: undercutterOn, intervalMinutes: undercutterInterval }),
    }).catch(() => {});
    if (!undercutterOn) return;
    const ms = undercutterInterval * 60 * 1000;
    const id = setInterval(() => { runUndercutter(); }, ms);
    return () => clearInterval(id);
  }, [undercutterOn, undercutterInterval]);

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch('/api/auto-sync-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json();
      setSyncResult(json);
    } catch (e: any) { setSyncResult({ error: e.message }); }
    finally { setSyncing(false); }
  };

  const fetchProducts = async () => {
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) return;
    setLoading(true); setError(null); setProducts([]); setSelected(new Set()); setResults(null); setMarketData({});
    try {
      const body = cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID };
      const res = await fetch('/api/my/onsale-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json() as any;
      if (!res.ok) { setError(json.error); return; }
      const prods: Product[] = json.products || [];
      setProducts(prods);

      // 카테고리별 시장 가격 병렬 로드
      const types = [...new Set(prods.map(p => p.productType))];
      const marketResults: Record<string, { products: any[]; count: number }> = {};
      await Promise.all(types.map(async (type) => {
        const key = typeToKey(type);
        if (!key) return;
        try {
          const r = await fetch(`/api/prices/${key}`);
          const d = await r.json() as any;
          marketResults[type] = { products: d.products || [], count: d.count || 0 };
        } catch {}
      }));
      setMarketData(marketResults);

      // management 데이터에서 서비스별 계정 이메일 매핑 (keepAcct 빈 게시물용)
      try {
        const mgRes = await fetch('/api/my/management', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }) });
        const mgJson = await mgRes.json() as any;
        const emap: Record<string, string> = {};
        for (const svc of (mgJson.services || [])) {
          for (const acct of svc.accounts) {
            if (acct.email && acct.email !== '(직접전달)') {
              // productType 매칭
              if (!emap[svc.serviceType]) emap[svc.serviceType] = acct.email;
            }
          }
        }
        setEmailMap(emap);
      } catch {}
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  // 내 상품의 시장 순위 계산
  const getMarketInfo = (p: Product): MarketInfo | null => {
    const md = marketData[p.productType];
    if (!md || !md.products.length || p.remainderDays <= 0) return null;
    const myDaily = Math.ceil(p.priceNum / p.remainderDays);
    const cheaper = md.products.filter((mp: any) => mp.pricePerDayNum < myDaily).length;
    const sameCount = md.products.filter((mp: any) => mp.pricePerDayNum === myDaily).length;
    const lowestDaily = md.products[0]?.pricePerDayNum || 0;
    return { lowestDaily, myRank: cheaper + 1, sameCount, total: md.count || md.products.length, myDaily };
  };

  // 선택 변경 시 기존 상품 안내 문구 자동 채우기
  const syncProductName = (newSelected: Set<string>) => {
    if (newSelected.size > 0 && !useProductName) {
      // 선택된 상품 중 첫 번째의 productName으로 채우기
      const first = products.find(p => newSelected.has(p.productUsid));
      if (first?.productName && !productNameEdit) {
        setProductNameEdit(first.productName);
      }
    }
  };

  const toggleSelect = (usid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(usid)) next.delete(usid);
      else next.add(usid);
      syncProductName(next);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      const all = new Set(products.map(p => p.productUsid));
      syncProductName(all);
      setSelected(all);
    }
  };

  // 서비스별 전체 선택
  const selectByType = (type: string) => {
    const usids = products.filter(p => p.productType === type).map(p => p.productUsid);
    const allSelected = usids.every(u => selected.has(u));
    setSelected(prev => {
      const next = new Set(prev);
      usids.forEach(u => allSelected ? next.delete(u) : next.add(u));
      syncProductName(next);
      return next;
    });
  };

  // 일당 가격 계산 (선택된 상품 중 대표 remainderDays 사용)
  const getRepDays = () => {
    const sel = products.filter(p => selected.has(p.productUsid));
    if (sel.length === 0) return 0;
    return sel[0].remainderDays;
  };

  const calcDailyFromTotal = () => {
    const p = parseInt(newPrice.replace(/,/g, '')) || 0;
    const days = getRepDays();
    if (days <= 0 || p <= 0) return null;
    return { daily: Math.ceil(p / days), days, total: p };
  };

  const calcTotalFromDaily = () => {
    const d = parseInt(newDailyPrice.replace(/,/g, '')) || 0;
    const days = getRepDays();
    if (days <= 0 || d <= 0) return null;
    return { daily: d, days, total: d * days };
  };

  const calcInfo = priceMode === 'total' ? calcDailyFromTotal() : calcTotalFromDaily();
  const finalPrice = priceMode === 'total' ? (parseInt(newPrice.replace(/,/g, '')) || 0) : (calcInfo?.total || 0);

  // 선택된 상품들 대표 서비스 타입 (손익분기 계산용)
  const getSelProductType = (): string | null => {
    const sel = products.filter(p => selected.has(p.productUsid));
    if (sel.length === 0) return null;
    return sel[0].productType;
  };

  // 손익분기 이익 계산
  const calcProfitInfo = (): { breakeven: number; profitPerDay: number; profitTotal: number; isPositive: boolean } | null => {
    const type = getSelProductType();
    if (!type || !calcInfo) return null;
    const breakeven = getBreakevenDaily(type);
    if (breakeven === null) return null;
    const days = calcInfo.days;
    const profitPerDay = calcInfo.daily - breakeven;
    const profitTotal = profitPerDay * days;
    return { breakeven, profitPerDay, profitTotal, isPositive: profitTotal >= 0 };
  };

  const togglePriceMode = () => {
    if (priceMode === 'total') {
      const info = calcDailyFromTotal();
      if (info) setNewDailyPrice(info.daily.toLocaleString());
      setPriceMode('daily');
    } else {
      const info = calcTotalFromDaily();
      if (info) setNewPrice(info.total.toLocaleString());
      setPriceMode('total');
    }
  };

  const handleUpdate = async () => {
    if (selected.size === 0 || finalPrice < 1000) return;
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) return;

    setUpdating(true); setResults(null); setError(null);
    try {
      const items = products
        .filter(p => selected.has(p.productUsid))
        .map(p => ({
          usid: p.productUsid,
          price: String(finalPrice),
          ...(useProductName && productNameEdit ? { name: productNameEdit } : {}),
        }));

      const body = {
        ...(cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }),
        products: items,
      };

      const res = await fetch('/api/my/update-price', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json() as any;
      if (!res.ok) setError(json.error);
      else {
        setResults(json.results || []);
        // 성공한 것들 가격 업데이트
        const successUsids = new Set((json.results || []).filter((r: UpdateResult) => r.ok).map((r: UpdateResult) => r.usid));
        setProducts(prev => prev.map(p => successUsids.has(p.productUsid) ? { ...p, price: finalPrice.toLocaleString() + '원', priceNum: finalPrice } : p));
      }
    } catch (e: any) { setError(e.message); }
    finally { setUpdating(false); }
  };

  const handleDelete = async () => {
    if (selected.size === 0) return;
    const cs = cookies.find(c => c.id === selectedId);
    if (!cs) return;

    setDeleting(true); setDeleteResults(null); setError(null); setShowDeleteConfirm(false);
    try {
      const body = {
        ...(cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID }),
        usids: [...selected],
      };
      const res = await fetch('/api/my/delete-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json() as any;
      if (!res.ok) setError(json.error);
      else {
        setDeleteResults(json.results || []);
        const deletedUsids = new Set((json.results || []).filter((r: UpdateResult) => r.ok).map((r: UpdateResult) => r.usid));
        setProducts(prev => prev.filter(p => !deletedUsids.has(p.productUsid)));
        setSelected(prev => { const next = new Set(prev); deletedUsids.forEach(u => next.delete(u)); return next; });
      }
    } catch (e: any) { setError(e.message); }
    finally { setDeleting(false); }
  };

  // 서비스별 그룹핑
  const serviceTypes = [...new Set(products.map(p => p.productType))];

  return (
    <div style={{ padding: '20px 16px 0' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>게시물 관리</h1>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>판매중 게시물 가격 변경 · 삭제</p>
        </div>
        <button onClick={fetchProducts} disabled={loading} style={{
          background: '#A78BFA', border: 'none', borderRadius: 12, padding: '8px 14px',
          fontSize: 13, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
          fontWeight: 600, fontFamily: 'inherit', opacity: loading ? 0.7 : 1,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
          {loading ? '조회중' : '조회'}
        </button>
      </div>

      {/* ─── Auto Undercutter 패널 ─── */}
      <div style={{ background: '#fff', borderRadius: 16, marginBottom: 12, border: '1.5px solid #FDE68A', overflow: 'hidden' }}>
        <button onClick={() => { setShowUndercutter(!showUndercutter); if (!showUndercutter) { runUndercutterPreview(); loadUndercutterLogs(); } }} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingDown size={16} color="#D97706" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>실시간 가격 자동 인하</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: undercutterOn ? '#059669' : '#9CA3AF', background: undercutterOn ? '#D1FAE5' : '#F3F4F6', padding: '2px 8px', borderRadius: 20 }}>
              {undercutterOn ? `ON · ${undercutterInterval}분` : 'OFF'}
            </span>
            {showUndercutter ? <ChevronUp size={16} color="#9CA3AF" /> : <ChevronDown size={16} color="#9CA3AF" />}
          </div>
        </button>

        {showUndercutter && (
          <div style={{ padding: '0 16px 16px' }}>
            {/* 설명 */}
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12, lineHeight: 1.6 }}>
              경쟁자가 내 가격보다 낮으면 <strong style={{ color: '#D97706' }}>1원씩</strong> 자동 인하.<br />
              마지노선: 넷플릭스·티빙 <strong>180원</strong>/일 · 웨이브·디즈니 <strong>110원</strong>/일<br />
              내 게시물끼리는 경쟁하지 않음.
            </div>

            {/* ON/OFF 토글 + 인터벌 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <button onClick={() => setUndercutterOn(v => !v)} style={{
                padding: '8px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700,
                background: undercutterOn ? '#059669' : '#E5E7EB',
                color: undercutterOn ? '#fff' : '#6B7280',
              }}>
                {undercutterOn ? '● ON' : '○ OFF'}
              </button>
              {undercutterOn && (
                <select value={undercutterInterval} onChange={e => setUndercutterInterval(Number(e.target.value))} style={{
                  padding: '8px 12px', borderRadius: 10, border: '1.5px solid #FDE68A',
                  fontSize: 12, fontFamily: 'inherit', background: '#FFFBEB', color: '#92400E', fontWeight: 600,
                }}>
                  <option value={3}>3분마다</option>
                  <option value={5}>5분마다</option>
                  <option value={10}>10분마다</option>
                  <option value={30}>30분마다</option>
                </select>
              )}
              {undercutterLastRun && (
                <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 'auto' }}>마지막: {undercutterLastRun}</span>
              )}
            </div>

            {/* 미리보기 결과 */}
            {undercutterPreview && !undercutterPreview.error && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>📊 현재 상태</div>
                {(undercutterPreview.results || []).map((r: any, i: number) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', borderRadius: 8, marginBottom: 4,
                    background: r.action === 'updated' ? '#FFFBEB' : r.action === 'at_floor' ? '#FFF0F0' : '#F9FAFB',
                    border: `1px solid ${r.action === 'updated' ? '#FDE68A' : r.action === 'at_floor' ? '#FCA5A5' : '#E5E7EB'}`,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1E1B4B' }}>{r.category}</span>
                    <span style={{ fontSize: 11, color: r.action === 'updated' ? '#D97706' : r.action === 'skip' ? '#059669' : '#6B7280' }}>
                      {r.action === 'updated' && `▼ ${r.myDaily}→${r.targetDaily}원/일`}
                      {r.action === 'skip' && `✓ 이미 최저 (${r.myDaily}원/일)`}
                      {r.action === 'at_floor' && `⚠ 마지노선 고정 (${r.floor}원)`}
                      {r.action === 'error' && `✕ ${r.reason}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 실행 결과 */}
            {undercutterResult && !undercutterResult.error && (
              <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #6EE7B7' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#059669', marginBottom: 4 }}>실행 완료</div>
                {(undercutterResult.results || []).filter((r: any) => r.action === 'updated').map((r: any, i: number) => (
                  <div key={i} style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                    {r.category}: {r.myDaily}원 → {r.targetDaily}원/일 ({r.updatedCount}개 업데이트)
                  </div>
                ))}
                {(undercutterResult.results || []).every((r: any) => r.action === 'skip') && (
                  <div style={{ fontSize: 11, color: '#6B7280' }}>변경 없음 (이미 최저가)</div>
                )}
              </div>
            )}
            {undercutterResult?.error && (
              <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 10, background: '#FFF0F0', fontSize: 12, color: '#EF4444' }}>
                {undercutterResult.error}
              </div>
            )}

            {/* 버튼들 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={runUndercutterPreview} disabled={undercutterRunning} style={{
                flex: 1, padding: '10px', borderRadius: 10, border: '1.5px solid #FDE68A',
                background: '#FFFBEB', fontSize: 12, fontWeight: 600, color: '#92400E',
                cursor: undercutterRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
                {undercutterRunning ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Info size={12} />}
                미리보기
              </button>
              <button onClick={runUndercutter} disabled={undercutterRunning} style={{
                flex: 2, padding: '10px', borderRadius: 10, border: 'none',
                background: undercutterRunning ? '#FDE68A' : '#F59E0B', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: undercutterRunning ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                boxShadow: '0 2px 8px rgba(245,158,11,0.25)',
              }}>
                {undercutterRunning ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <TrendingDown size={13} />}
                {undercutterRunning ? '실행 중...' : '▼ 지금 실행'}
              </button>
            </div>

            {/* 최근 로그 */}
            {undercutterLogs.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>최근 실행 이력</div>
                {undercutterLogs.slice(0, 5).map((log: any, i: number) => {
                  const updated = (log.results || []).filter((r: any) => r.action === 'updated');
                  const t = new Date(log.timestamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={i} style={{ fontSize: 11, color: '#9CA3AF', padding: '4px 0', borderBottom: i < 4 ? '1px solid #F3F4F6' : 'none' }}>
                      <span style={{ color: '#6B7280', fontWeight: 600 }}>{t}</span>
                      {updated.length > 0
                        ? updated.map((r: any) => ` · ${r.category} ${r.myDaily}→${r.targetDaily}원`).join('')
                        : ' · 변경 없음'}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 일당 가격 자동 동기화 설정 */}
      <div style={{ background: '#fff', borderRadius: 16, marginBottom: 12, border: '1.5px solid #EDE9FE', overflow: 'hidden' }}>
        <button onClick={() => setShowRateSettings(!showRateSettings)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={16} color="#A78BFA" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1E1B4B' }}>일당 가격 자동 동기화</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>매일 자정 자동 실행</span>
            {showRateSettings ? <ChevronUp size={16} color="#9CA3AF" /> : <ChevronDown size={16} color="#9CA3AF" />}
          </div>
        </button>

        {showRateSettings && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>
              매일 자정에 각 게시물의 현재 일당 가격을 기준으로 (잔여일 × 일당) 가격이 자동 변경됩니다.
            </div>

            {/* 동기화 버튼만 */}
            <div>
              <button onClick={handleSync} disabled={syncing} style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px', borderRadius: 10, border: 'none',
                background: syncing ? '#FDE68A' : '#F59E0B', color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
              }}>
                {syncing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={14} />}
                {syncing ? '동기화 중...' : '⚡ 지금 동기화 실행'}
              </button>
            </div>

            {/* 동기화 결과 */}
            {syncResult && (
              <div style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 10,
                background: syncResult.error ? '#FFF0F0' : '#F0FDF4',
                border: `1px solid ${syncResult.error ? '#FCA5A5' : '#6EE7B7'}`,
              }}>
                {syncResult.error ? (
                  <div style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>{syncResult.error}</div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>
                      {syncResult.updated || 0}개 변경 · {syncResult.skipped || 0}개 스킵 (총 {syncResult.totalOnSale || 0}개)
                    </div>
                    {(syncResult.results || []).filter((r: any) => r.action === 'updated').map((r: any, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: '#6B7280', marginTop: 3 }}>
                        {r.svc}: {r.from?.toLocaleString()}원 → {r.to?.toLocaleString()}원 ({r.daily}원×{r.days}일)
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ background: '#FFF0F0', borderRadius: 14, padding: '12px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#EF4444' }}>
            <AlertCircle size={14} /> {error}
          </div>
        </div>
      )}

      {/* 결과 배너 */}
      {results && (
        <div style={{
          background: results.every(r => r.ok) ? '#F0FDF4' : '#FFFBEB',
          borderRadius: 14, padding: '12px 16px', marginBottom: 12,
          border: `1.5px solid ${results.every(r => r.ok) ? '#6EE7B7' : '#FDE68A'}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: results.every(r => r.ok) ? '#059669' : '#D97706' }}>
            {results.filter(r => r.ok).length}/{results.length}개 변경 완료
            {finalPrice > 0 && ` → ${finalPrice.toLocaleString()}원`}
          </div>
          {results.filter(r => !r.ok).map(r => (
            <div key={r.usid} style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>{r.usid}: {r.error}</div>
          ))}
        </div>
      )}

      {/* 삭제 결과 배너 */}
      {deleteResults && (
        <div style={{
          background: deleteResults.every(r => r.ok) ? '#F0FDF4' : '#FFFBEB',
          borderRadius: 14, padding: '12px 16px', marginBottom: 12,
          border: `1.5px solid ${deleteResults.every(r => r.ok) ? '#6EE7B7' : '#FDE68A'}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: deleteResults.every(r => r.ok) ? '#059669' : '#D97706' }}>
            {deleteResults.filter(r => r.ok).length}/{deleteResults.length}개 삭제 완료
          </div>
          {deleteResults.filter(r => !r.ok).map(r => (
            <div key={r.usid} style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>{r.usid}: {r.error}</div>
          ))}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} style={{ background: '#fff', borderRadius: 16, height: 70, opacity: 0.5, animation: 'pulse 1.5s infinite' }} />)}
        </div>
      )}

      {/* 초기 */}
      {!loading && products.length === 0 && !error && (
        <div style={{ background: '#EDE9FE', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <DollarSign size={32} color="#C4B5FD" style={{ margin: '0 auto 10px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#7C3AED' }}>조회 버튼을 눌러주세요</div>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>판매중인 게시물을 불러와요</div>
        </div>
      )}

      {/* 상품 목록 */}
      {products.length > 0 && !loading && (
        <>
          {/* 전체 선택 + 현황 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10, padding: '8px 0',
          }}>
            <button onClick={selectAll} style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              color: selected.size === products.length ? '#A78BFA' : '#6B7280',
            }}>
              {selected.size === products.length ? <CheckSquare size={16} /> : <Square size={16} />}
              전체 선택 ({selected.size}/{products.length})
            </button>
          </div>

          {/* 서비스별 그룹 */}
          {serviceTypes.map(type => {
            const cat = svcColor(type);
            const typeProducts = products.filter(p => p.productType === type);
            const allTypeSelected = typeProducts.every(p => selected.has(p.productUsid));
            return (
              <div key={type} style={{ marginBottom: 14 }}>
                <button onClick={() => selectByType(type)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  padding: 0,
                }}>
                  {allTypeSelected ? <CheckSquare size={14} color="#A78BFA" /> : <Square size={14} color="#9CA3AF" />}
                  {cat?.logo && <img src={cat.logo} alt={type} style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <span style={{ fontSize: 13, fontWeight: 700, color: cat?.color || '#1E1B4B' }}>{type}</span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{typeProducts.length}개</span>
                  {marketData[type] && marketData[type].products[0] && (
                    <span style={{ fontSize: 10, color: '#059669', fontWeight: 600, marginLeft: 4 }}>
                      최저 {marketData[type].products[0].pricePerDayNum}원/일
                    </span>
                  )}
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {typeProducts.map(p => {
                    const isSelected = selected.has(p.productUsid);
                    const wasUpdated = results?.find(r => r.usid === p.productUsid);
                    return (
                      <button key={p.productUsid} onClick={() => toggleSelect(p.productUsid)} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                        background: '#fff', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                        textAlign: 'left', width: '100%',
                        border: `1.5px solid ${isSelected ? '#A78BFA' : wasUpdated?.ok ? '#6EE7B7' : '#F3F0FF'}`,
                        boxShadow: '0 1px 6px rgba(167,139,250,0.06)',
                      }}>
                        {isSelected ? <CheckSquare size={18} color="#A78BFA" style={{ flexShrink: 0 }} /> : <Square size={18} color="#D1D5DB" style={{ flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.productName}
                          </div>
                          {(() => {
                            const acct = p.keepAcct || emailMap[p.productType] || '';
                            if (!acct) return null;
                            return (
                              <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {acct.includes('@') ? acct.split('@')[0] : acct}
                              </div>
                            );
                          })()}
                          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>
                            {p.remainderDays}일 남음 · {p.endDateTime}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#A78BFA' }}>{p.price}</div>
                          {p.remainderDays > 0 && (() => {
                            const mi = getMarketInfo(p);
                            const daily = Math.ceil(p.priceNum / p.remainderDays);
                            return (
                              <>
                                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                                  일당 {daily.toLocaleString()}원
                                </div>
                                {mi && (
                                  <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                    marginTop: 3, padding: '1px 6px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                                    background: mi.myRank <= 3 ? '#F0FDF4' : mi.myRank <= 5 ? '#FFFBEB' : '#FFF0F0',
                                    color: mi.myRank <= 3 ? '#059669' : mi.myRank <= 5 ? '#D97706' : '#EF4444',
                                  }}>
                                    {mi.myRank === 1 && mi.sameCount <= 1 ? <Trophy size={8} /> : mi.myRank > 5 ? <TrendingDown size={8} /> : null}
                                    {mi.sameCount > 1 ? `공동 ${mi.myRank}위` : `${mi.myRank}위`}/{mi.total}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        {wasUpdated && (
                          <div style={{ flexShrink: 0 }}>
                            {wasUpdated.ok ? <Check size={16} color="#059669" strokeWidth={3} /> : <AlertCircle size={16} color="#EF4444" />}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 가격 입력 + 변경 버튼 (선택 시 표시) */}
          {selected.size > 0 && (
            <div style={{
              position: 'sticky', bottom: 72, background: '#fff', borderRadius: 20,
              padding: 16, boxShadow: '0 -4px 24px rgba(167,139,250,0.15)',
              border: '1.5px solid #EDE9FE', marginTop: 8, zIndex: 50,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 8 }}>
                {selected.size}개 선택됨
              </div>

              {/* 가격 모드 토글 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1E1B4B' }}>
                  {priceMode === 'total' ? '총 가격 (원)' : '일당 가격 (원)'}
                </span>
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
                <input type="text" inputMode="numeric" value={newPrice}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setNewPrice(raw ? Number(raw).toLocaleString() : '');
                  }}
                  placeholder="새 가격 입력"
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #EDE9FE',
                    fontSize: 16, fontWeight: 700, color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }} />
              ) : (
                <input type="text" inputMode="numeric" value={newDailyPrice}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setNewDailyPrice(raw ? Number(raw).toLocaleString() : '');
                  }}
                  placeholder="일당 가격 입력"
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #EDE9FE',
                    fontSize: 16, fontWeight: 700, color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
                    fontFamily: 'inherit', boxSizing: 'border-box',
                  }} />
              )}

              {/* 계산 결과 + 손익분기 */}
              {calcInfo && (() => {
                const profit = calcProfitInfo();
                return (
                  <>
                    <div style={{ background: '#F8F6FF', borderRadius: 10, padding: '8px 12px', marginTop: 8 }}>
                      {priceMode === 'total' ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280' }}>
                          <span>일당 <strong style={{ color: '#A78BFA' }}>{calcInfo.daily.toLocaleString()}원</strong></span>
                          <span>{calcInfo.days}일 기준</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6B7280' }}>
                          <span>총 <strong style={{ color: '#A78BFA' }}>{calcInfo.total.toLocaleString()}원</strong></span>
                          <span>{calcInfo.days}일 × {calcInfo.daily.toLocaleString()}원</span>
                        </div>
                      )}
                    </div>

                    {/* 손익분기 & 예상 이익 */}
                    {profit && (
                      <div style={{
                        marginTop: 8, borderRadius: 12, overflow: 'hidden',
                        border: `1.5px solid ${profit.isPositive ? '#6EE7B7' : profit.profitTotal > -500 ? '#FDE68A' : '#FCA5A5'}`,
                      }}>
                        {/* 마지노선 행 */}
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '7px 12px', background: '#F8F6FF',
                          borderBottom: '1px solid #EDE9FE',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Info size={11} color="#9CA3AF" />
                            <span style={{ fontSize: 11, color: '#9CA3AF' }}>손익분기 마지노선</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {profit.breakeven < 0 ? (
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>
                                추가공유만으로 흑자
                              </span>
                            ) : (
                              <>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#7C3AED' }}>
                                  {profit.breakeven}원/일
                                </span>
                                <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                                  (총 {(profit.breakeven * calcInfo.days).toLocaleString()}원)
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* 예상 이익 행 */}
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '9px 12px',
                          background: profit.isPositive ? '#F0FDF4' : profit.profitTotal > -500 ? '#FFFBEB' : '#FFF0F0',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            {profit.isPositive
                              ? <TrendingUp size={13} color="#059669" />
                              : <TrendingDown size={13} color={profit.profitTotal > -500 ? '#D97706' : '#EF4444'} />
                            }
                            <span style={{
                              fontSize: 12, fontWeight: 700,
                              color: profit.isPositive ? '#059669' : profit.profitTotal > -500 ? '#D97706' : '#EF4444',
                            }}>
                              예상 {profit.isPositive ? '이익' : '손실'}
                            </span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{
                              fontSize: 15, fontWeight: 800,
                              color: profit.isPositive ? '#059669' : profit.profitTotal > -500 ? '#D97706' : '#EF4444',
                            }}>
                              {profit.isPositive ? '+' : ''}{profit.profitTotal.toLocaleString()}원
                            </span>
                            <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 6 }}>
                              ({profit.profitPerDay > 0 ? '+' : ''}{profit.profitPerDay}원/일)
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {finalPrice > 0 && finalPrice < 1000 && (
                <div style={{ fontSize: 11, color: '#EF4444', marginTop: 6 }}>최소 1,000원 이상이어야 합니다</div>
              )}

              {/* 상품 안내 문구 */}
              <div style={{ marginTop: 10 }}>
                <button onClick={() => setUseProductName(!useProductName)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  color: useProductName ? '#A78BFA' : '#9CA3AF', padding: 0, marginBottom: 6,
                }}>
                  {useProductName ? <CheckSquare size={14} /> : <Square size={14} />}
                  <FileText size={12} />
                  상품 안내 문구도 변경
                </button>
                {useProductName && (
                  <>
                    <input type="text" value={productNameEdit}
                      onChange={e => setProductNameEdit(e.target.value)}
                      placeholder="상품 안내 문구 입력 (예: ✅ 셀프인증 가능! ✅ 넷플릭스 프리미엄!)"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #EDE9FE',
                        fontSize: 13, fontWeight: 600, color: '#1E1B4B', background: '#F8F6FF', outline: 'none',
                        fontFamily: 'inherit', boxSizing: 'border-box',
                      }} />
                    {/* 기존 문구 빠른 선택 */}
                    {(() => {
                      const selProducts = products.filter(p => selected.has(p.productUsid));
                      const uniqueNames = [...new Set(selProducts.map(p => p.productName).filter(Boolean))];
                      if (uniqueNames.length === 0) return null;
                      return (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 4 }}>기존 문구 재사용:</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {uniqueNames.map((name, i) => (
                              <button key={i} onClick={() => setProductNameEdit(name)} style={{
                                background: productNameEdit === name ? '#EDE9FE' : '#F9FAFB',
                                border: `1px solid ${productNameEdit === name ? '#A78BFA' : '#E5E7EB'}`,
                                borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                                fontFamily: 'inherit', fontSize: 11, color: '#1E1B4B', textAlign: 'left',
                                fontWeight: productNameEdit === name ? 700 : 400,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* 삭제 확인 */}
              {showDeleteConfirm && (
                <div style={{
                  background: '#FFF0F0', borderRadius: 12, padding: '12px 14px', marginTop: 8,
                  border: '1.5px solid #FCA5A5',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', marginBottom: 8 }}>
                    {selected.size}개 게시물을 삭제하시겠습니까?
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setShowDeleteConfirm(false)} style={{
                      flex: 1, padding: '10px', borderRadius: 10, border: '1.5px solid #E5E7EB',
                      background: '#fff', fontSize: 13, fontWeight: 600, color: '#6B7280',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>취소</button>
                    <button onClick={handleDelete} disabled={deleting} style={{
                      flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                      background: deleting ? '#FCA5A5' : '#EF4444', fontSize: 13, fontWeight: 700, color: '#fff',
                      cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                      {deleting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
                      {deleting ? '삭제 중...' : '삭제'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {/* 삭제 버튼 */}
              <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting} style={{
                flex: 1, background: '#FFF0F0', border: '1.5px solid #FCA5A5', borderRadius: 12,
                padding: 14, fontSize: 13, color: '#EF4444', fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Trash2 size={15} /> 삭제
              </button>

              {/* 가격 변경 버튼 */}
              <button onClick={handleUpdate} disabled={updating || finalPrice < 1000} style={{
                flex: 2, background: updating ? '#C4B5FD' : '#A78BFA',
                border: 'none', borderRadius: 12, padding: 14, fontSize: 15, color: '#fff',
                fontWeight: 700, cursor: updating ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                boxShadow: '0 4px 16px rgba(167,139,250,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                {updating ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <DollarSign size={16} />}
                {updating ? `변경 중...` : `가격 변경 → ${finalPrice > 0 ? finalPrice.toLocaleString() + '원' : ''}`}
              </button>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ height: 20 }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.4} 50%{opacity:.7}}`}</style>
    </div>
  );
}
