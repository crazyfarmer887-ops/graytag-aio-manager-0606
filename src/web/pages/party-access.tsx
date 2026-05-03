import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";

type AccessPayload = {
  ok: boolean;
  reason?: string;
  serviceType?: string;
  accountEmail?: string;
  memberName?: string;
  profileName?: string;
  emailAccessUrl?: string;
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

function credentialRows(payload: AccessPayload): Array<{ label: string; value: string; link?: string }> {
  const c = payload.credentials;
  return [
    { label: 'ID', value: c?.id || '' },
    { label: 'PW', value: c?.password || '' },
    { label: 'EMAIL', value: payload.emailAccessUrl || '', link: payload.emailAccessUrl || '' },
    { label: '이메일 접근 PIN번호', value: c?.pin || '' },
  ];
}

export default function PartyAccessPage() {
  const token = decodeURIComponent(window.location.pathname.split('/access/')[1] || '');
  const [payload, setPayload] = useState<AccessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [consentInput, setConsentInput] = useState('');
  const [consentOk, setConsentOk] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/party-access/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => ({ res, json: await res.json().catch(() => ({})) }))
      .then(({ json }) => { if (alive) setPayload(json as AccessPayload); })
      .catch(() => { if (alive) setPayload({ ok: false, reason: 'network-error' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    const profileName = payload?.profileName || payload?.memberName || '';
    if (!payload?.ok || !profileName) return;
    try { setConsentOk(localStorage.getItem(`access-consent:${token}`) === profileName); } catch {}
  }, [payload?.ok, payload?.profileName, payload?.memberName, token]);

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

  const profileName = payload.profileName || payload.memberName || '(미확인)';
  const showConsent = Boolean(profileName && !consentOk);
  const acceptConsent = () => {
    if (consentInput.trim() !== profileName) return;
    try { localStorage.setItem(`access-consent:${token}`, profileName); } catch {}
    setConsentOk(true);
  };

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(180deg,#F8F6FF,#FFFFFF)', padding:'28px 16px 40px', boxSizing:'border-box' }}>
      {showConsent && (
        <div style={{ position:'fixed', inset:0, zIndex:100, background:'linear-gradient(180deg,#F8F6FF,#FFFFFF)', padding:'28px 16px', boxSizing:'border-box', display:'grid', placeItems:'center' }}>
          <div style={{ width:'100%', maxWidth:460, background:'#fff', borderRadius:26, padding:22, boxShadow:'0 20px 70px rgba(124,58,237,0.18)', border:'1.5px solid #EDE9FE', textAlign:'center' }}>
            <div style={{ fontSize:18, fontWeight:1000, color:'#EF4444', marginBottom:14 }}>⚠️ 1인 1프로필 원칙 안내 ⚠️</div>
            <div style={{ fontSize:13, color:'#6B7280', fontWeight:800, marginBottom:6 }}>배정된 프로필 이름</div>
            <div style={{ fontSize:32, color:'#1E1B4B', fontWeight:1000, lineHeight:1.15, marginBottom:16 }}>{profileName}</div>
            <div style={{ fontSize:13, color:'#4B5563', lineHeight:1.7, textAlign:'left', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:16, padding:14, fontWeight:700 }}>
              프로필을 만드실 때(혹은 프로필을 만드셨을 경우) 해당 이름으로 꼭 만드신 뒤(혹은 변경하신 뒤) 사용하셔야 합니다. 그리고 반드시 위 프로필만 사용해주세요.<br /><br />
              <span style={{ display:'block', margin:'10px 0', padding:'9px 10px', borderRadius:10, background:'linear-gradient(transparent 32%, #FDE047 32% 86%, transparent 86%)', color:'#92400E', fontSize:15, fontWeight:1000, lineHeight:1.55 }}>일주일 단위로 해당 닉네임이 아닌 프로필은 삭제될 예정이니 꼭 주의 바랍니다!</span>
              다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다.
              <span style={{ display:'block', margin:'10px 0', padding:'9px 10px', borderRadius:10, background:'#EEF2FF', border:'1px solid #C7D2FE', color:'#3730A3', fontWeight:1000 }}>이메일 인증 필요시, 동의 후 나오는 이메일 인증 열기를 눌러, 하단에 보이는 핀번호를 입력하면 접근 가능하니 참고 바랍니다.</span>
              기타 문의 연락은 구매처에서 14:00 ~ 21:00 중으로 연락주시면 답변드리고 있으니 참고 바랍니다.
            </div>
            <div style={{ marginTop:16, fontSize:13, color:'#6B7280', fontWeight:900 }}>동의하신다면, 아래 입력 칸에 "{profileName}"을 입력해주세요.</div>
            <input value={consentInput} onChange={e => setConsentInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') acceptConsent(); }} placeholder={profileName} autoFocus style={{ width:'100%', marginTop:10, padding:'13px 14px', borderRadius:14, border:'1.5px solid #C4B5FD', boxSizing:'border-box', fontSize:18, fontWeight:900, textAlign:'center', color:'#1E1B4B', outline:'none', fontFamily:'inherit' }} />
            <button onClick={acceptConsent} disabled={consentInput.trim() !== profileName} style={{ width:'100%', marginTop:10, padding:14, border:'none', borderRadius:14, background:consentInput.trim() === profileName ? '#7C3AED' : '#C4B5FD', color:'#fff', fontSize:15, fontWeight:1000, cursor:consentInput.trim() === profileName ? 'pointer' : 'not-allowed', fontFamily:'inherit' }}>동의하고 계정 정보 보기</button>
          </div>
        </div>
      )}
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

          <div style={{ background:'#EEF2FF', border:'1.5px solid #C7D2FE', borderRadius:16, padding:'13px 14px', marginBottom:10, textAlign:'center' }}>
            <div style={{ fontSize:11, color:'#4F46E5', fontWeight:1000 }}>구매자님이 만들어야 하는 프로필 이름</div>
            <div style={{ fontSize:24, color:'#1E1B4B', fontWeight:1000, marginTop:4 }}>{profileName}</div>
          </div>

          <div style={{ display:'grid', gap:10 }}>
            {credentialRows(payload).map((row) => (
              <div key={row.label} style={{ background:'#FFFFFF', border:'1.5px solid #EDE9FE', borderRadius:16, padding:'12px 14px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                  <div style={{ fontSize:11, color:'#7C3AED', fontWeight:900, display:'flex', alignItems:'center', gap:5 }}>{row.label === 'EMAIL' ? <Mail size={12} /> : <KeyRound size={12} />} {row.label}</div>
                  {row.link ? <a href={row.link} target="_blank" rel="noreferrer" style={{ border:'none', borderRadius:999, background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:900, padding:'6px 10px', textDecoration:'none' }}>이메일 인증 열기</a> : <button onClick={() => copy(row.value)} style={{ border:'none', borderRadius:999, background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:900, padding:'6px 10px', cursor:'pointer' }}>복사</button>}
                </div>
                <div style={{ fontSize:16, color:'#1E1B4B', fontWeight:900, marginTop:6, wordBreak:'break-all' }}>{row.link ? '이메일 인증/핀번호 확인 링크' : (row.value || '-')}</div>
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
