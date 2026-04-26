import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { CATEGORIES, RANK_COLORS } from "../lib/constants";
import { Frown, Trophy, Zap, Copy, Check } from "lucide-react";

interface Product {
  rank: number; usid: string; name: string; lenderName: string;
  pricePerDay: string; pricePerDayNum: number; price: string;
  purePrice: number; endDate: string; remainderDays: number; seats: number; category: string;
}
interface PriceData { category: string; count: number; products: Product[]; updatedAt: string; }

export default function PricePage() {
  const params = useParams<{ category?: string }>();
  const [, navigate] = useLocation();
  const [activeKey, setActiveKey] = useState(params.category || 'netflix');
  const [data, setData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedRank, setCopiedRank] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchPrices = async (key: string) => {
    setLoading(true); setData(null); setError(null);
    try {
      const res = await fetch(`/api/prices/${key}`);
      const json = await res.json();
      if (!res.ok || json.error) { setError(json.error || '조회 실패'); return; }
      setData(json);
    }
    catch (e: any) { setError(e.message || '네트워크 오류'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPrices(activeKey); }, [activeKey]);

  const activeCat = CATEGORIES.find(c => c.key === activeKey)!;

  const handleCat = (key: string) => {
    setActiveKey(key);
    navigate(`/price/${key}`, { replace: true });
  };

  // 3등 뺏기 가격 계산: 3등의 일당가 - 1원
  const getStealPrice = (): { dailyPrice: number; rank3Daily: number } | null => {
    if (!data?.products || data.products.length < 3) return null;
    const rank3 = data.products[2]; // 0-indexed, 3번째
    if (!rank3) return null;
    return { dailyPrice: rank3.pricePerDayNum - 1, rank3Daily: rank3.pricePerDayNum };
  };

  const stealInfo = getStealPrice();

  const copyStealPrice = () => {
    if (!stealInfo) return;
    navigator.clipboard.writeText(String(stealInfo.dailyPrice));
    setCopiedRank(3);
    setTimeout(() => setCopiedRank(null), 1500);
  };

  if (!activeCat) {
    return <div style={{ padding: 20, color: 'red' }}>카테고리를 찾을 수 없습니다</div>;
  }

  return (
    <div style={{ paddingTop: 20 }}>
      {/* Header */}
      <div style={{ padding: '0 16px 16px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1E1B4B', margin: 0 }}>가격 추적</h1>
        <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>일당 최저가 TOP 10 · 실시간</p>
      </div>

      {/* Category Tabs */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 8, padding: '0 16px 16px', overflowX: 'auto' }}>
        {CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => handleCat(cat.key)} style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 20, border: 'none', fontFamily: 'inherit',
            fontSize: 13, fontWeight: activeKey === cat.key ? 700 : 500, cursor: 'pointer',
            background: activeKey === cat.key ? '#A78BFA' : '#fff',
            color: activeKey === cat.key ? '#fff' : '#6B7280',
            boxShadow: activeKey === cat.key ? '0 4px 12px rgba(167,139,250,0.3)' : '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <img src={cat.logo} alt={cat.label} style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, filter: activeKey === cat.key ? 'brightness(0) invert(1)' : 'none' }}
              onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
            {cat.label}
          </button>
        ))}
      </div>

      {/* Active Category Info */}
      {!loading && data && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ background: activeCat.bg, borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={activeCat.logo} alt={activeCat.label} style={{ width: 30, height: 30, objectFit: 'contain', borderRadius: 6 }}
                onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: activeCat.color }}>{data.category}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>판매 중</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: activeCat.color }}>{data.count}개</div>
            </div>
          </div>
        </div>
      )}

      {/* 3등 뺏기 추천 카드 */}
      {!loading && stealInfo && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
            borderRadius: 14, padding: '14px 16px',
            border: '1.5px solid #F59E0B',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Zap size={16} color="#D97706" strokeWidth={2.5} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>3등 뺏기 추천 가격</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, color: '#92400E' }}>{stealInfo.dailyPrice.toLocaleString()}원</span>
                  <span style={{ fontSize: 12, color: '#B45309' }}>/일</span>
                </div>
                <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>
                  현재 3등 일당가 {stealInfo.rank3Daily.toLocaleString()}원 보다 1원 저렴
                </div>
              </div>
              <button onClick={copyStealPrice} style={{
                background: '#fff', border: '1.5px solid #F59E0B', borderRadius: 10,
                padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#92400E',
                cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {copiedRank === 3 ? <><Check size={13} /> 복사됨</> : <><Copy size={13} /> 복사</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1~5등 하이라이트 */}
      {!loading && data?.products && data.products.length > 0 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B', marginBottom: 8 }}>🏆 TOP 5 일당가</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }} className="no-scrollbar">
            {data.products.slice(0, 5).map((p, i) => (
              <div key={p.usid} style={{
                flexShrink: 0, minWidth: 100, background: '#fff', borderRadius: 14, padding: '12px 14px',
                border: `2px solid ${i === 0 ? '#A78BFA' : i === 1 ? '#6EE7B7' : i === 2 ? '#FCA5A5' : '#EDE9FE'}`,
                textAlign: 'center', position: 'relative',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, margin: '0 auto 6px',
                  background: RANK_COLORS[i] || '#E9E4FF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13, color: i <= 2 ? '#fff' : '#6B7280',
                }}>
                  {i === 0 ? <Trophy size={14} color="#fff" /> : i + 1}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1E1B4B' }}>{p.pricePerDayNum.toLocaleString()}원</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>/일</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.lenderName}
                </div>
                <div style={{ fontSize: 10, color: '#C4B5FD', marginTop: 2 }}>총 {p.purePrice.toLocaleString()}원</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price List */}
      <div style={{ padding: '0 16px' }}>
        {error ? (
          <div style={{ background: '#FFF0F0', borderRadius: 16, padding: '20px', textAlign: 'center', color: '#E50914' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>조회 실패</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>{error}</div>
            <button onClick={() => fetchPrices(activeKey)} style={{ marginTop: 12, padding: '8px 20px', background: '#A78BFA', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>다시 시도</button>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...Array(5)].map((_, i) => <div key={i} style={{ height: 80, background: '#fff', borderRadius: 16, opacity: 0.5, animation: 'pulse 1.5s infinite' }} />)}
          </div>
        ) : data?.products && data.products.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.products.map(p => (
              <div key={p.usid} style={{
                background: '#fff', borderRadius: 16, padding: '14px 16px',
                boxShadow: '0 2px 12px rgba(167,139,250,0.08)', border: '1px solid #F3F0FF',
                display: 'flex', gap: 12, alignItems: 'center',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: p.rank <= 5 ? RANK_COLORS[p.rank-1] : '#E9E4FF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, color: p.rank <= 3 ? '#fff' : '#6B7280',
                }}>
                  {p.rank === 1 ? <Trophy size={16} color="#fff" strokeWidth={2.5} /> : p.rank}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1E1B4B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name || p.category}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>👤 {p.lenderName}</span>
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>· {p.remainderDays}일 남음</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#A78BFA' }}>{p.pricePerDayNum.toLocaleString()}원</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>/일 · 총 {p.purePrice.toLocaleString()}원</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 16, padding: '40px 20px', textAlign: 'center', color: '#9CA3AF' }}>
            <Frown size={32} color="#C4B5FD" style={{ margin: '0 auto 8px' }} />
            <div>현재 판매 중인 파티가 없어요</div>
          </div>
        )}
      </div>

      <div style={{ height: 20 }} />
      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.7} }`}</style>
    </div>
  );
}
