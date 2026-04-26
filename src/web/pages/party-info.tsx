import { useState, useEffect } from "react";
import { RefreshCw, Loader2, AlertCircle, ChevronDown, ChevronRight, Users, Clock, TrendingUp, ExternalLink, Calendar } from "lucide-react";
import { CATEGORIES } from "../lib/constants";

interface PartyProduct {
  productUsid: string;
  productName: string;
  price: string;
  purePrice: number;
  endDateTime: string;
  remainderDays: number;
  keepAcct: string;
  keepPasswd: string;
  keepMemo?: string;
  usingCount?: number;
  totalSlots?: number;
  pricePerDayNum?: number;
  members?: { name: string | null; status: string; statusName: string; startDateTime: string | null; endDateTime: string | null; }[];
}

interface ServiceCategory {
  key: string;
  label: string;
  color: string;
  bg: string;
  logo: string;
  emoji: string;
  products: PartyProduct[];
  totalProducts: number;
  avgDailyPrice: number;
  usingMembers: number;
}

const AUTO_COOKIE_ID = "__session_keeper__";
const AUTO_COOKIE: CookieSet = { id: AUTO_COOKIE_ID, label: "자동 (Session Keeper)", AWSALB: "", AWSALBCORS: "", JSESSIONID: "__auto__" };
const STORAGE_KEY = "graytag_cookies_v2";
interface CookieSet { id: string; label: string; AWSALB: string; AWSALBCORS: string; JSESSIONID: string; }
const loadCookies = (): CookieSet[] => { try { return [AUTO_COOKIE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")]; } catch { return [AUTO_COOKIE]; } };

const fmtMoney = (n: number) => n > 0 ? n.toLocaleString() + "원" : "-";
const fmtDate = (s: string | null) => {
  if (!s) return "-";
  const m = s.match(/(\d{4})(\d{2})(\d{2})T/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  return s.replace(/\s/g, "").replace(/\.(?=\S)/g, "/").replace(/\.$/, "");
};

const PARTY_MAX: Record<string, number> = {
  "디즈니플러스": 6, "왓챠플레이": 4, "티빙": 4, "웨이브": 4,
};

// 서비스 타입 -> CATEGORIES key 매핑
const svcToKey = (svcType: string): string => {
  const map: Record<string, string> = {
    "웨이브": "wavve", "디즈니플러스": "disney", "왓챠플레이": "watcha",
    "넷플릭스": "netflix", "티빙": "tving", "유튜브": "youtube",
    "라프텔": "laftel", "쿠팡플레이": "coupang", "AppleOne": "apple", "프라임비디오": "prime",
  };
  return map[svcType] || svcType.toLowerCase();
};

export default function PartyInfoPage() {
  const cookies = loadCookies();
  const [selectedId, setSelectedId] = useState(cookies[0]?.id || "");
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const doFetch = async (id?: string) => {
    const cs = cookies.find(c => c.id === (id || selectedId));
    if (!cs) return;
    setLoading(true); setError(null);
    try {
      const body = cs.id === AUTO_COOKIE_ID ? {} : { AWSALB: cs.AWSALB, AWSALBCORS: cs.AWSALBCORS, JSESSIONID: cs.JSESSIONID };
      const res = await fetch("/api/my/management", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json() as any;
      if (!res.ok) { setError(json.error || "오류 발생"); return; }

      setUpdatedAt(json.updatedAt);

      // onSaleByKeepAcct에서 파티 정보 추출 + services에서 멤버 수 보강
      const catMap: Record<string, ServiceCategory> = {};

      // services에서 계정별 usingCount 수집
      const acctUsing: Record<string, number> = {};
      for (const svc of (json.services || [])) {
        for (const acct of svc.accounts) {
          acctUsing[acct.email] = (acctUsing[acct.email] || 0) + (acct.usingCount || 0);
        }
      }

      // onSaleByKeepAcct 순회
      for (const [email, products] of Object.entries(json.onSaleByKeepAcct || {})) {
        for (const prod of (products as PartyProduct[])) {
          // svcType 찾기 - onSaleProducts에 serviceType 없을 수 있으니 services에서 매핑
          let svcType = "";
          for (const svc of (json.services || [])) {
            for (const acct of svc.accounts) {
              if (acct.email === email) { svcType = svc.serviceType; break; }
            }
            if (svcType) break;
          }
          if (!svcType) continue;

          const catKey = svcToKey(svcType);
          const catInfo = CATEGORIES.find(c => c.key === catKey);

          if (!catMap[catKey]) {
            catMap[catKey] = {
              key: catKey,
              label: svcType,
              color: catInfo?.color || "#6B7280",
              bg: catInfo?.bg || "#F3F4F6",
              logo: catInfo?.logo || "",
              emoji: catInfo?.emoji || "📺",
              products: [],
              totalProducts: 0,
              avgDailyPrice: 0,
              usingMembers: 0,
            };
          }

          const maxSlots = PARTY_MAX[svcType] || 6;
          catMap[catKey].products.push({
            ...prod,
            totalSlots: maxSlots,
            usingCount: acctUsing[email] || 0,
          });
        }
      }

      // 통계 계산
      const result: ServiceCategory[] = [];
      for (const cat of Object.values(catMap)) {
        cat.totalProducts = cat.products.length;
        const dailyPrices = cat.products.filter(p => p.purePrice > 0 && p.remainderDays > 0).map(p => Math.ceil(p.purePrice / p.remainderDays));
        cat.avgDailyPrice = dailyPrices.length > 0 ? Math.ceil(dailyPrices.reduce((a, b) => a + b, 0) / dailyPrices.length) : 0;
        // usingMembers: 이 카테고리에 속한 이메일들의 usingCount 합
        const emailsInCat = new Set(cat.products.map(p => p.keepAcct));
        cat.usingMembers = [...emailsInCat].reduce((sum, email) => sum + (acctUsing[email] || 0), 0);
        // 종료일 기준 정렬
        cat.products.sort((a, b) => (a.endDateTime || "").localeCompare(b.endDateTime || ""));
        result.push(cat);
      }

      // 서비스 순서: CATEGORIES 기준
      result.sort((a, b) => {
        const ai = CATEGORIES.findIndex(c => c.key === a.key);
        const bi = CATEGORIES.findIndex(c => c.key === b.key);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      setCategories(result);
      if (result.length > 0) setOpenCat(result[0].key);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const getRemainingDays = (endDt: string) => {
    if (!endDt) return 0;
    const m = endDt.match(/^(\d{4})(\d{2})(\d{2})T/);
    if (!m) return 0;
    const end = new Date(`${m[1]}-${m[2]}-${m[3]}`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.ceil((end.getTime() - today.getTime()) / 86400000);
  };

  const totalOnSale = categories.reduce((s, c) => s + c.totalProducts, 0);
  const totalUsing = categories.reduce((s, c) => s + c.usingMembers, 0);

  return (
    <div style={{ padding: "20px 16px 0" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1E1B4B", margin: 0 }}>파티 정보</h1>
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: "4px 0 0" }}>
            {updatedAt ? `${new Date(updatedAt).getHours().toString().padStart(2,"0")}:${new Date(updatedAt).getMinutes().toString().padStart(2,"0")} 기준` : "서비스별 파티 게시글 현황"}
          </p>
        </div>
        <button onClick={() => doFetch()} disabled={loading} style={{ background: "#A78BFA", border: "none", borderRadius: 12, padding: "8px 14px", fontSize: 13, color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontWeight: 600, fontFamily: "inherit", opacity: loading ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}>
          {loading ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={14} />}
          {loading ? "조회중" : "조회"}
        </button>
      </div>

      {/* 계정 선택 */}
      {cookies.length > 1 && (
        <div className="no-scrollbar" style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto" }}>
          {cookies.map(cs => (
            <button key={cs.id} onClick={() => setSelectedId(cs.id)} style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 20, border: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", background: selectedId === cs.id ? "#A78BFA" : "#fff", color: selectedId === cs.id ? "#fff" : "#6B7280", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              {cs.label}
            </button>
          ))}
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{ background: "#FFF0F0", borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#EF4444" }}>
            <AlertCircle size={15} /> 오류
          </div>
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>{error}</div>
        </div>
      )}

      {/* 초기 안내 */}
      {!categories.length && !loading && !error && (
        <div style={{ background: "#EDE9FE", borderRadius: 16, padding: 20, textAlign: "center" }}>
          <Calendar size={32} color="#C4B5FD" style={{ margin: "0 auto 10px" }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#7C3AED" }}>조회 버튼을 눌러주세요</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>서비스별 파티 게시글 현황을 확인해요</div>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} style={{ background: "#fff", borderRadius: 16, height: 80, opacity: 0.5, animation: "pulse 1.5s infinite" }} />)}
        </div>
      )}

      {/* 요약 배너 */}
      {categories.length > 0 && !loading && (
        <div style={{ background: "linear-gradient(135deg, #A78BFA 0%, #818CF8 100%)", borderRadius: 20, padding: "14px 18px", marginBottom: 14, color: "#fff" }}>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>판매 중인 파티</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, textAlign: "center" }}>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 4px" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{totalOnSale}건</div>
              <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}>총 게시글</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 4px" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{totalUsing}명</div>
              <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}>이용 중</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "8px 4px" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{categories.length}개</div>
              <div style={{ fontSize: 9, opacity: 0.8, marginTop: 2 }}>서비스</div>
            </div>
          </div>
        </div>
      )}

      {/* 서비스 카테고리별 */}
      {categories.length > 0 && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {categories.map(cat => {
            const isOpen = openCat === cat.key;
            return (
              <div key={cat.key} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(167,139,250,0.08)", border: `1.5px solid ${isOpen ? "#A78BFA" : "#F3F0FF"}` }}>
                {/* 카테고리 헤더 */}
                <button onClick={() => setOpenCat(isOpen ? null : cat.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {cat.logo ? (
                      <img src={cat.logo} alt={cat.label} style={{ width: 28, height: 28, objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : <span style={{ fontSize: 22 }}>{cat.emoji}</span>}
                  </div>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1E1B4B" }}>{cat.label}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                        <span style={{ fontWeight: 700, color: cat.color }}>{cat.totalProducts}건</span> 모집 중
                      </span>
                      {cat.usingMembers > 0 && (
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                          이용중 <span style={{ fontWeight: 700, color: "#059669" }}>{cat.usingMembers}명</span>
                        </span>
                      )}
                      {cat.avgDailyPrice > 0 && (
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                          평균 일당 <span style={{ fontWeight: 700, color: "#A78BFA" }}>{cat.avgDailyPrice.toLocaleString()}원</span>
                        </span>
                      )}
                    </div>
                  </div>
                  {isOpen ? <ChevronDown size={16} color="#A78BFA" /> : <ChevronRight size={16} color="#A78BFA" />}
                </button>

                {/* 게시글 목록 */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid #F3F0FF", padding: "8px 12px 12px" }}>
                    {cat.products.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: "12px 0" }}>판매 중인 파티 없음</div>
                    ) : cat.products.map(prod => {
                      const isProductOpen = openProduct === prod.productUsid;
                      const remainDays = getRemainingDays(prod.endDateTime);
                      const daily = prod.remainderDays > 0 ? Math.ceil(prod.purePrice / prod.remainderDays) : 0;
                      const isExpiringSoon = remainDays <= 7 && remainDays > 0;
                      const isExpired = remainDays <= 0;
                      return (
                        <div key={prod.productUsid} style={{ marginBottom: 8, background: isExpired ? "#FFF5F5" : isExpiringSoon ? "#FFFBEB" : "#F8F6FF", borderRadius: 12, overflow: "hidden", border: `1px solid ${isExpired ? "#FCA5A5" : isExpiringSoon ? "#FDE68A" : "#EDE9FE"}` }}>
                          <button onClick={() => setOpenProduct(isProductOpen ? null : prod.productUsid)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                            <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#1E1B4B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prod.productName}</div>
                              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                                <span style={{ fontSize: 11, color: "#6B7280" }}>
                                  <span style={{ fontWeight: 700, color: "#A78BFA" }}>{fmtMoney(prod.purePrice)}</span>
                                </span>
                                {daily > 0 && <span style={{ fontSize: 10, color: "#9CA3AF" }}>{daily.toLocaleString()}원/일</span>}
                                <span style={{ fontSize: 10, fontWeight: 600, color: isExpired ? "#EF4444" : isExpiringSoon ? "#D97706" : "#059669", background: isExpired ? "#FFF0F0" : isExpiringSoon ? "#FFFBEB" : "#ECFDF5", borderRadius: 6, padding: "1px 7px", display: "flex", alignItems: "center", gap: 3 }}>
                                  <Clock size={9} />
                                  {isExpired ? "만료" : `D-${remainDays}`}
                                </span>
                              </div>
                              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>
                                {prod.keepAcct} · 종료 {fmtDate(prod.endDateTime)}
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                              <a href={`https://graytag.co.kr/product/detail?productUsid=${prod.productUsid}`} target="_blank" rel="noreferrer"
                                onClick={e => e.stopPropagation()}
                                style={{ fontSize: 10, color: "#7C3AED", display: "flex", alignItems: "center", gap: 2, textDecoration: "none", background: "#EDE9FE", borderRadius: 6, padding: "3px 7px" }}>
                                <ExternalLink size={9} /> 보기
                              </a>
                              {isProductOpen ? <ChevronDown size={13} color="#C4B5FD" /> : <ChevronRight size={13} color="#C4B5FD" />}
                            </div>
                          </button>

                          {/* 상세 정보 */}
                          {isProductOpen && (
                            <div style={{ borderTop: "1px solid #EDE9FE", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                              <InfoRow label="계정 (이메일)" value={prod.keepAcct} />
                              <InfoRow label="비밀번호" value={prod.keepPasswd || "-"} mono />
                              <InfoRow label="종료일" value={fmtDate(prod.endDateTime)} />
                              <InfoRow label="가격" value={`${fmtMoney(prod.purePrice)}${daily > 0 ? " (일당 " + daily.toLocaleString() + "원)" : ""}`} />
                              {prod.keepMemo && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", marginBottom: 4 }}>계정 전달 메모</div>
                                  <div style={{ fontSize: 11, color: "#1E1B4B", background: "#fff", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap", border: "1px solid #EDE9FE", lineHeight: 1.5 }}>
                                    {prod.keepMemo}
                                  </div>
                                </div>
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
      )}

      <div style={{ height: 20 }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.4} 50%{opacity:.7}}`}</style>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", minWidth: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: "#1E1B4B", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
