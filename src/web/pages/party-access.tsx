import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";

type AccessPayload = {
  ok: boolean;
  reason?: string;
  serviceType?: string;
  accountEmail?: string;
  memberName?: string;
  period?: { startDateTime: string | null; endDateTime: string | null };
  credentials?: { id: string; password: string; pin: string; updatedAt: string };
};

const fmtDate = (value?: string | null) => {
  if (!value) return '-';
  const m = value.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/) || value.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!m) return value;
  if (m[1].length === 2) return `20${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}`;
  return `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}`;
};

function credentialRows(payload: AccessPayload) {
  const c = payload.credentials;
  return [
    { label: 'ID', value: c?.id || '' },
    { label: 'PW', value: c?.password || '' },
    { label: 'PIN', value: c?.pin || '' },
  ];
}

export default function PartyAccessPage() {
  const token = decodeURIComponent(window.location.pathname.split('/access/')[1] || '');
  const [payload, setPayload] = useState<AccessPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/party-access/${encodeURIComponent(token)}`)
      .then(async (res) => ({ res, json: await res.json().catch(() => ({})) }))
      .then(({ json }) => { if (alive) setPayload(json as AccessPayload); })
      .catch(() => { if (alive) setPayload({ ok: false, reason: 'network-error' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const copy = async (value: string) => {
    if (!value) return;
    try { await navigator.clipboard?.writeText(value); } catch {}
  };

  if (loading) {
    return <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#F8F6FF', color:'#7C3AED', fontWeight:900 }}><Loader2 size={24} style={{ animation:'spin 1s linear infinite' }} /> 계정 정보 확인 중...</div>;
  }

  if (!payload?.ok) {
    return (
      <div style={{ minHeight:'100vh', background:'#F8F6FF', padding:'32px 18px', boxSizing:'border-box', display:'grid', placeItems:'center' }}>
        <div style={{ width:'100%', maxWidth:420, background:'#fff', borderRadius:24, padding:22, boxShadow:'0 16px 50px rgba(124,58,237,0.14)', textAlign:'center', border:'1px solid #EDE9FE' }}>
          <Lock size={34} color="#EF4444" />
          <h1 style={{ fontSize:20, color:'#1E1B4B', margin:'12px 0 6px' }}>계정 정보 접근이 종료됐어요</h1>
          <p style={{ fontSize:13, color:'#6B7280', lineHeight:1.6, margin:0 }}>이용기간이 끝났거나 판매자가 접근을 막은 링크입니다. 문의가 필요하면 판매자에게 메시지 주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(180deg,#F8F6FF,#FFFFFF)', padding:'28px 16px 40px', boxSizing:'border-box' }}>
      <div style={{ maxWidth:460, margin:'0 auto' }}>
        <div style={{ background:'#fff', borderRadius:24, padding:20, boxShadow:'0 16px 50px rgba(124,58,237,0.14)', border:'1px solid #EDE9FE' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <div style={{ width:42, height:42, borderRadius:14, background:'#F5F3FF', display:'grid', placeItems:'center' }}><ShieldCheck size={22} color="#7C3AED" /></div>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:'#1E1B4B' }}>최신 ID · PW · PIN</div>
              <div style={{ fontSize:12, color:'#9CA3AF', fontWeight:800 }}>이용기간 중에만 계정 정보를 확인할 수 있어요</div>
            </div>
          </div>

          <div style={{ background:'#F8F6FF', borderRadius:16, padding:12, marginBottom:12 }}>
            <div style={{ fontSize:12, color:'#6B7280', fontWeight:800 }}>{payload.serviceType} · {payload.memberName}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>{fmtDate(payload.period?.startDateTime)} ~ {fmtDate(payload.period?.endDateTime)}</div>
          </div>

          <div style={{ display:'grid', gap:10 }}>
            {credentialRows(payload).map((row) => (
              <div key={row.label} style={{ background:'#FFFFFF', border:'1.5px solid #EDE9FE', borderRadius:16, padding:'12px 14px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                  <div style={{ fontSize:11, color:'#7C3AED', fontWeight:900, display:'flex', alignItems:'center', gap:5 }}><KeyRound size={12} /> {row.label}</div>
                  <button onClick={() => copy(row.value)} style={{ border:'none', borderRadius:999, background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:900, padding:'6px 10px', cursor:'pointer' }}>복사</button>
                </div>
                <div style={{ fontSize:16, color:'#1E1B4B', fontWeight:900, marginTop:6, wordBreak:'break-all' }}>{row.value || '-'}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop:14, background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:14, padding:12, color:'#92400E', fontSize:12, lineHeight:1.55, fontWeight:700 }}>
            비밀번호가 갑자기 안 되면 판매자에게 바로 알려주세요. 링크는 이용 종료 후 자동으로 막힙니다.
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
