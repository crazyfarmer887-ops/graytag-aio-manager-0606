import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, RefreshCw, Loader2, Send, ChevronLeft, ArrowDown, Sparkles, ChevronDown, Bell, Settings, ToggleLeft, ToggleRight } from "lucide-react";
import { autoReplyStatusLabel, autoReplyStatusTone, summarizeAutoReplyJobs, type AutoReplyLogJob } from "../lib/auto-reply-log";
import { groupChatRoomsByAccount, sortChatRoomsByLatestBuyerMessage, type ChatSortMode } from "../lib/chat-room-sort";

interface ChatRoom {
  dealUsid: string; chatRoomUuid: string; borrowerName: string;
  borrowerThumbnail: string; productType: string; productName: string;
  dealStatus: string; statusName: string; remainderDays: number;
  lenderChatUnread: boolean; price: string; keepAcct: string;
  lastMessage?: string; lastMessageTime?: string;
}
interface ChatMessage {
  message: string; registeredDateTime: string; isOwned: boolean;
  isInfo: boolean; isRead: boolean; messageType: string;
}

const STATUS_COLORS: Record<string, string> = {
  Using: '#A78BFA', UsingNearExpiration: '#F59E0B', Delivered: '#3B82F6',
  Delivering: '#06B6D4', OnSale: '#10B981', NormalFinished: '#9CA3AF',
};

const decodeHtml = (html: string) => {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
};

const stripHtml = (html: string) => {
  return decodeHtml(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
};

export default function ChatPage() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [sendText, setSendText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState(400);
  const [resizing, setResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [chatSortMode, setChatSortMode] = useState<ChatSortMode>('latest');
  const msgEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeRef = useRef<number>(400);

  // 자동응답 state
  const [arEnabled, setArEnabled] = useState<boolean>(true);
  const [arDelay, setArDelay] = useState<number>(0);
  const [arPrompt, setArPrompt] = useState<string>("");
  const [arPromptOpen, setArPromptOpen] = useState<boolean>(false);
  const [arLogs, setArLogs] = useState<string[]>([]);
  const [arJobs, setArJobs] = useState<AutoReplyLogJob[]>([]);
  const [arLogLoading, setArLogLoading] = useState<boolean>(false);
  const [arSaving, setArSaving] = useState<boolean>(false);
  const [arPanel, setArPanel] = useState<boolean>(false);
  // 공지 state
  const [noticePanel, setNoticePanel] = useState<boolean>(false);
  const [noticeEmail, setNoticeEmail] = useState<string>("");
  const [noticeMsg, setNoticeMsg] = useState<string>("");
  const [noticeSending, setNoticeSending] = useState<boolean>(false);
  const [noticeResult, setNoticeResult] = useState<any>(null);
  const [accountList, setAccountList] = useState<string[]>([]);

  // 채팅 페이지 마운트 시 #root max-width 해제
  useEffect(() => {
    const root = document.getElementById('root');
    root?.classList.add('chat-fullscreen');
    return () => root?.classList.remove('chat-fullscreen');
  }, []);

  // 모바일에서는 목록/대화 화면을 한 번에 하나만 보여준다.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // 채팅방 목록 로드
  const loadAutoReplyLog = useCallback(async () => {
    setArLogLoading(true);
    try {
      const res = await fetch('/api/chat/auto-reply-log?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setArJobs(data.jobs || []);
      setArLogs((data.logs || []).slice(-3));
    } catch {}
    finally { setArLogLoading(false); }
  }, []);

  const loadRooms = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/chat/rooms');
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setRooms(data.rooms || []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  // 메시지 로드
  const loadMessages = useCallback(async (uuid: string, pg: number, append = false) => {
    setMsgLoading(true);
    try {
      const res = await fetch(`/api/chat/messages/${uuid}?page=${pg}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      if (!res.ok) return;
      const msgs = data.messages || [];
      if (append) setMessages(prev => [...prev, ...msgs]);
      else setMessages(msgs);
      setHasMore(data.hasMore);
      setPage(pg);
    } catch {}
    finally { setMsgLoading(false); }
  }, []);

  // 초기 로드
  useEffect(() => {
    loadRooms();
    (async () => {
      try {
        const [sr, pr, lr] = await Promise.all([
          fetch("/api/chat/auto-reply/state"),
          fetch("/api/chat/auto-reply/prompt"),
          fetch("/api/chat/auto-reply-log"),
        ]);
        if (sr.ok) { const d = await sr.json(); setArEnabled(d.enabled); setArDelay(d.delaySeconds ?? 0); }
        if (pr.ok) { const d = await pr.json(); setArPrompt(d.systemPrompt ?? ""); }
        if (lr.ok) { const d = await lr.json(); setArJobs(d.jobs || []); setArLogs((d.logs || []).slice(-3)); }
      } catch {}
    })();
  }, [loadRooms]);

  // 1분 polling
  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadRooms();
      setPollCount(c => c + 1);
      if (selectedRoom) loadMessages(selectedRoom.chatRoomUuid, 1);
    }, 60000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedRoom, loadRooms, loadMessages]);

  // 사이드바 리사이즈
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing) return;
      const w = Math.max(300, Math.min(640, e.clientX));
      resizeRef.current = w;
      setSidebarWidth(w);
    };
    const onUp = () => setResizing(false);
    if (resizing) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing]);

  const selectRoom = (room: ChatRoom) => {
    setSelectedRoom(room);
    setMessages([]);
    setPage(1);
    loadMessages(room.chatRoomUuid, 1);
  };


  useEffect(() => {
    const targetRoom = new URLSearchParams(window.location.search).get('room');
    if (!targetRoom || rooms.length === 0 || selectedRoom?.chatRoomUuid === targetRoom) return;
    const room = rooms.find(r => r.chatRoomUuid === targetRoom);
    if (room) selectRoom(room);
  }, [rooms, selectedRoom?.chatRoomUuid]);

  const markRoomRead = async (room: ChatRoom) => {
    const previous = rooms;
    setRooms(prev => prev.map(r => r.chatRoomUuid === room.chatRoomUuid ? { ...r, lenderChatUnread: false } : r));
    if (selectedRoom?.chatRoomUuid === room.chatRoomUuid) setSelectedRoom({ ...room, lenderChatUnread: false });
    try {
      const res = await fetch('/api/chat/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatRoomUuid: room.chatRoomUuid }) });
      if (!res.ok) throw new Error('읽음 처리 실패');
      setTimeout(() => loadRooms(), 400);
    } catch (e: any) {
      setRooms(previous);
      alert(e.message || '읽음 처리 실패');
    }
  };

  const loadMore = () => {
    if (!selectedRoom || msgLoading) return;
    loadMessages(selectedRoom.chatRoomUuid, page + 1, true);
  };

  const handleSend = async () => {
    if (!sendText.trim() || !selectedRoom || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatRoomUuid: selectedRoom.chatRoomUuid, dealUsid: selectedRoom.dealUsid, message: sendText.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSendText('');
        setTimeout(() => loadMessages(selectedRoom.chatRoomUuid, 1), 1500);
      } else { alert(data.error || '전송 실패'); }
    } catch (e: any) { alert(e.message); }
    finally { setSending(false); }
  };

  const handleAiReply = async () => {
    if (!selectedRoom || messages.length === 0 || aiLoading) return;
    setAiLoading(true);
    try {
      const cleanMsgs = messages.map(m => ({
        message: m.message.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
        isOwned: m.isOwned,
      }));
      const res = await fetch('/api/chat/ai-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: cleanMsgs, productType: selectedRoom.productType }),
      });
      const data = await res.json() as any;
      if (res.ok && data.reply) setSendText(data.reply);
      else alert(data.error || 'AI 응답 생성 실패');
    } catch (e: any) { alert(e.message); }
    finally { setAiLoading(false); }
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return '방금';
    if (mins < 60) return `${mins}분`;
    if (hours < 24) return `${hours}시간`;
    if (days < 7) return `${days}일`;
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };

  const visibleRooms = () => {
    const sourceRooms = unreadOnly ? rooms.filter(r => r.lenderChatUnread) : rooms;
    return sortChatRoomsByLatestBuyerMessage(sourceRooms);
  };

  const groupedRooms = () => groupChatRoomsByAccount(visibleRooms());

  // 자동응답 액션
  const toggleAr = async () => {
    const next = !arEnabled; setArEnabled(next);
    await fetch("/api/chat/auto-reply/state", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({enabled:next}) });
  };
  const saveArDelay = async (val: number) => {
    await fetch("/api/chat/auto-reply/state", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({delaySeconds:val}) });
  };
  const saveArPrompt = async () => {
    setArSaving(true);
    try { await fetch("/api/chat/auto-reply/prompt", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({systemPrompt:arPrompt}) }); }
    finally { setArSaving(false); }
  };

  // 공지 액션
  const loadAccounts = async () => {
    try {
      const res = await fetch("/api/my/management", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({}) });
      if (!res.ok) return;
      const data = await res.json();
      const em = new Set<string>();
      (data.services||[]).forEach((s:any) => (s.accounts||[]).forEach((a:any) => {
        if(a.email && a.email!=="(직접전달)") em.add("["+a.serviceType+"] "+a.email);
      }));
      setAccountList(Array.from(em));
    } catch {}
  };
  const sendNotice = async () => {
    if (!noticeEmail || !noticeMsg.trim()) return;
    // FIX: 올바른 정규식으로 "[서비스] " 접두어 제거
    const em = noticeEmail.replace(/^\[.*?\]\s*/, "");
    if (!confirm(em + " 파티원들에게 공지 발송할까요?")) return;
    setNoticeSending(true); setNoticeResult(null);
    try {
      const res = await fetch("/api/chat/notice/send", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({targetEmail:em, message:noticeMsg}),
      });
      setNoticeResult(await res.json());
    } catch(e:any) { setNoticeResult({ok:false,error:e.message}); }
    finally { setNoticeSending(false); }
  };

  // ── 패널 렌더러 ─────────────────────────────────────────────

  const renderArPanel = () => {
    const arSummary = summarizeAutoReplyJobs(arJobs);
    return (
    <div style={{background:"#F5F3FF", borderBottom:"1px solid #DDD6FE", padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <Settings size={14} color="#7C3AED"/>
        <span style={{fontWeight:700,color:"#1E1B4B",fontSize:13,flex:1}}>자동응답</span>
        <button onClick={toggleAr} style={{border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:4,
          color:arEnabled?"#7C3AED":"#9CA3AF",fontSize:12,fontWeight:700,padding:"2px 6px",borderRadius:6,
          background:arEnabled?"#EDE9FE":"#F3F4F6"} as any}>
          {arEnabled?<ToggleRight size={18} color="#7C3AED"/>:<ToggleLeft size={18} color="#9CA3AF"/>}
          {arEnabled?"ON":"OFF"}
        </button>
        <button onClick={()=>setArPanel(p=>!p)} style={{background:"none",border:"none",cursor:"pointer",color:"#9CA3AF",fontSize:11,padding:"2px 4px"}}>
          {arPanel?"접기 ▴":"설정 ▾"}
        </button>
      </div>
      {arPanel&&(
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
            <span style={{color:"#6B7280",minWidth:42}}>딜레이</span>
            <input type="range" min={0} max={600} step={10} value={arDelay}
              onChange={e=>setArDelay(Number(e.target.value))}
              onMouseUp={()=>saveArDelay(arDelay)} style={{flex:1,accentColor:"#7C3AED"}}/>
            <span style={{color:"#7C3AED",fontWeight:700,minWidth:38,textAlign:"right"}}>{arDelay===0?"즉시":arDelay+"초"}</span>
          </div>
          <div style={{fontSize:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,alignItems:"center"}}>
              <span style={{color:"#6B7280",fontWeight:600}}>시스템 프롬프트</span>
              <button onClick={()=>setArPromptOpen(p=>!p)} style={{background:"none",border:"none",cursor:"pointer",color:"#7C3AED",fontSize:11}}>{arPromptOpen?"접기":"편집 ▾"}</button>
            </div>
            {arPromptOpen&&<>
              <textarea value={arPrompt} onChange={e=>setArPrompt(e.target.value)}
                style={{width:"100%",height:120,fontSize:11,padding:8,border:"1px solid #DDD6FE",borderRadius:8,resize:"vertical",boxSizing:"border-box" as any,fontFamily:"monospace",lineHeight:1.5}}/>
              <button onClick={saveArPrompt} disabled={arSaving}
                style={{marginTop:6,background:arSaving?"#DDD6FE":"#7C3AED",color:"#fff",border:"none",borderRadius:8,padding:"6px 16px",fontSize:12,cursor:"pointer",fontWeight:600}}>
                {arSaving?"저장 중...":"저장"}
              </button>
            </>}
          </div>
          <div style={{background:"#fff",border:"1px solid #DDD6FE",borderRadius:10,padding:"10px 12px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:12,fontWeight:700,color:"#1E1B4B"}}>자동응답 큐</span>
              <button onClick={loadAutoReplyLog} disabled={arLogLoading} style={{background:"#EDE9FE",border:"none",borderRadius:7,padding:"4px 8px",fontSize:11,fontWeight:700,color:"#7C3AED",cursor:"pointer"}}>
                {arLogLoading?"새로고침 중":"새로고침"}
              </button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
              <div style={{background:"#F5F3FF",borderRadius:8,padding:6,textAlign:"center"}}><div style={{fontSize:15,fontWeight:800,color:"#7C3AED"}}>{arSummary.drafted}</div><div style={{fontSize:10,color:"#6B7280"}}>초안</div></div>
              <div style={{background:"#FFF7ED",borderRadius:8,padding:6,textAlign:"center"}}><div style={{fontSize:15,fontWeight:800,color:"#C2410C"}}>{arSummary.blocked}</div><div style={{fontSize:10,color:"#6B7280"}}>확인</div></div>
              <div style={{background:"#ECFDF5",borderRadius:8,padding:6,textAlign:"center"}}><div style={{fontSize:15,fontWeight:800,color:"#047857"}}>{arSummary.sent}</div><div style={{fontSize:10,color:"#6B7280"}}>발송</div></div>
              <div style={{background:"#FEF2F2",borderRadius:8,padding:6,textAlign:"center"}}><div style={{fontSize:15,fontWeight:800,color:"#B91C1C"}}>{arSummary.error}</div><div style={{fontSize:10,color:"#6B7280"}}>오류</div></div>
            </div>
            {arJobs.length===0 ? (
              <div style={{fontSize:11,color:"#9CA3AF",padding:"8px 0",textAlign:"center"}}>자동응답 작업 없음</div>
            ) : arJobs.slice(0,5).map(job=>{
              const tone=autoReplyStatusTone(job.status);
              return <div key={job.id} style={{borderTop:"1px solid #F3F0FF",padding:"8px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{fontSize:10,fontWeight:800,borderRadius:999,padding:"2px 6px",background:tone.background,color:tone.color}}>{autoReplyStatusLabel(job.status)}</span>
                  <span style={{fontSize:11,fontWeight:700,color:"#1E1B4B",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.buyerName||'구매자'} · {job.productType||'기타'}</span>
                </div>
                <div style={{fontSize:11,color:"#6B7280",lineHeight:1.45,wordBreak:"break-word"}}>문의: {(job.buyerMessage||'').slice(0,80)}</div>
                {job.draftReply&&<div style={{fontSize:11,color:"#7C3AED",lineHeight:1.45,wordBreak:"break-word",marginTop:3}}>초안: {job.draftReply.slice(0,100)}</div>}
                {job.draftReply&&<button onClick={()=>{ const room=rooms.find(r=>r.chatRoomUuid===job.chatRoomUuid); if(room) selectRoom(room); setSendText(job.draftReply||''); }} style={{marginTop:6,background:"#7C3AED",color:"#fff",border:"none",borderRadius:7,padding:"5px 8px",fontSize:11,fontWeight:700,cursor:"pointer"}}>초안 입력</button>}
                {job.blockReason&&<div style={{fontSize:10,color:"#9CA3AF",marginTop:3}}>사유: {job.blockReason}</div>}
              </div>;
            })}
          </div>
          {arLogs.length>0&&(
            <div style={{background:"#1E1B4B",borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontSize:10,color:"#7C3AED",marginBottom:4,fontWeight:600}}>최근 로그</div>
              {arLogs.map((l,i)=><div key={i} style={{fontSize:10,color:"#C4B5FD",fontFamily:"monospace",lineHeight:1.5,wordBreak:"break-all"}}>{l.slice(0,100)}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
    );
  };

  const renderNoticePanel = () => (
    <div style={{background:"#FFF7ED",borderBottom:"1px solid #FED7AA",padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <Bell size={14} color="#EA580C"/>
        <span style={{fontWeight:700,color:"#1E1B4B",fontSize:13,flex:1}}>파티원 공지</span>
        <button onClick={()=>{setNoticePanel(p=>!p); if(!noticePanel)loadAccounts();}}
          style={{background:"none",border:"none",cursor:"pointer",color:"#9CA3AF",fontSize:11,padding:"2px 4px"}}>
          {noticePanel?"접기 ▴":"발송 ▾"}
        </button>
      </div>
      {noticePanel&&(
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
          <select value={noticeEmail} onChange={e=>setNoticeEmail(e.target.value)}
            style={{fontSize:12,padding:"7px 10px",border:"1.5px solid #FED7AA",borderRadius:8,background:"#fff",color:"#1E1B4B"}}>
            <option value="">계정 선택...</option>
            {accountList.map(e=><option key={e} value={e}>{e}</option>)}
          </select>
          <textarea value={noticeMsg} onChange={e=>setNoticeMsg(e.target.value)}
            placeholder="공지 내용을 입력하세요 (최대 500자)" maxLength={500} rows={4}
            style={{fontSize:13,padding:10,border:"1.5px solid #FED7AA",borderRadius:8,resize:"vertical",boxSizing:"border-box" as any,lineHeight:1.6,fontFamily:"inherit"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:"#9CA3AF",fontSize:11}}>{noticeMsg.length}/500</span>
            <button onClick={sendNotice} disabled={noticeSending||!noticeEmail||!noticeMsg.trim()}
              style={{background:noticeSending||!noticeEmail||!noticeMsg.trim()?"#FED7AA":"#EA580C",
                color:noticeSending||!noticeEmail||!noticeMsg.trim()?"#9CA3AF":"#fff",
                border:"none",borderRadius:8,padding:"7px 18px",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.2s"}}>
              {noticeSending?"발송 중...":"전체 발송"}
            </button>
          </div>
          {noticeResult&&(
            <div style={{background:noticeResult.ok?"#ECFDF5":"#FEF2F2",
              border:"1.5px solid "+(noticeResult.ok?"#BBF7D0":"#FECACA"),
              borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:500}}>
              {noticeResult.ok
                ? `✓ 성공 ${noticeResult.sent}명 / 실패 ${noticeResult.failed}명 / 건너뜀 ${noticeResult.skipped}명`
                : `✗ ${noticeResult.error||"발송 실패"}`}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderRoomButton = (room: ChatRoom, nested = false) => (
    <button key={room.dealUsid} onClick={()=>selectRoom(room)}
      style={{width:"100%",padding:"12px 16px 12px "+(nested?"44px":"16px"),display:"flex",alignItems:"center",gap:12,
        background:selectedRoom?.dealUsid===room.dealUsid?"#EDE9FE":room.lenderChatUnread?"#F5F3FF":"transparent",
        border:"none",cursor:"pointer",borderBottom:"1px solid #F8F6FF",fontFamily:"inherit",transition:"background 0.15s"}}>
      <div style={{width:38,height:38,borderRadius:10,flexShrink:0,overflow:"hidden",background:"#EDE9FE",position:"relative"}}>
        <img src={room.borrowerThumbnail||''} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}
          onError={(e)=>{(e.target as HTMLImageElement).style.display="none";}}/>
        <div style={{position:"absolute",bottom:0,right:0,width:10,height:10,borderRadius:"50%",
          background:STATUS_COLORS[room.dealStatus]||"#9CA3AF",border:"2px solid #fff"}}/>
      </div>
      <div style={{flex:1,minWidth:0,textAlign:"left"}}>
        <div style={{fontSize:13,fontWeight:room.lenderChatUnread?700:500,color:"#1E1B4B",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {room.borrowerName}
        </div>
        <div style={{fontSize:11,color:"#9CA3AF",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:2}}>
          {room.lastMessage?stripHtml(room.lastMessage).slice(0,32):"메시지 없음"}
        </div>
        {chatSortMode==='latest'&&<div style={{fontSize:10,color:'#C4B5FD',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:2}}>{room.productType} · {room.keepAcct || '(직접전달)'}</div>}
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,flexShrink:0}}>
        <div style={{fontSize:10,color:"#9CA3AF"}}>{formatTime(room.lastMessageTime||'')}</div>
        <div style={{background:room.lenderChatUnread?"#EF4444":"#F3F4F6",color:room.lenderChatUnread?"#fff":"#6B7280",borderRadius:10,padding:"2px 6px",fontSize:9,fontWeight:800}}>{room.lenderChatUnread?"안읽음":"읽음"}</div>
      </div>
    </button>
  );

  // ── 사이드바 ─────────────────────────────────────────────────

  const renderSidebar = () => (
    <div style={{display:"flex",flexDirection:"column",background:"#FDFBFF",flex:1}}>
      <div style={{padding:"16px 18px",borderBottom:"1px solid #EDE9FE",flexShrink:0}}>
        <h2 style={{fontSize:15,fontWeight:700,color:"#1E1B4B",margin:0}}>채팅</h2>
        <p style={{fontSize:11,color:"#9CA3AF",margin:"4px 0 0"}}>
          {rooms.length}개 · 미읽 {rooms.filter(r=>r.lenderChatUnread).length}개
        </p>
        {isMobile&&<p style={{fontSize:10,color:'#A78BFA',margin:'4px 0 0',fontWeight:700}}>모바일 모드 · 방을 누르면 대화 화면으로 이동</p>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:"10px 14px 0",flexShrink:0}}>
        <button onClick={()=>setChatSortMode('latest')}
          style={{fontSize:12,fontWeight:800,padding:"8px 0",borderRadius:9,background:chatSortMode==='latest'?"#7C3AED":"#F3F4F6",border:"none",cursor:"pointer",color:chatSortMode==='latest'?"#fff":"#6B7280"}}>
          구매자 메시지 최신순
        </button>
        <button onClick={()=>setChatSortMode('account')}
          style={{fontSize:12,fontWeight:800,padding:"8px 0",borderRadius:9,background:chatSortMode==='account'?"#7C3AED":"#F3F4F6",border:"none",cursor:"pointer",color:chatSortMode==='account'?"#fff":"#6B7280"}}>
          계정별 정리
        </button>
      </div>
      <div style={{display:"flex",gap:8,padding:"10px 14px",borderBottom:"1px solid #EDE9FE",flexShrink:0}}>
        <button onClick={()=>setUnreadOnly(v=>!v)}
          style={{flex:1,fontSize:12,fontWeight:700,padding:"7px 0",borderRadius:8,background:unreadOnly?"#FEF3C7":"#F3F4F6",border:"none",cursor:"pointer",color:unreadOnly?"#B45309":"#6B7280"}}>
          안읽음만 보기
        </button>
        <button onClick={()=>{
          if(!confirm(`안읽음 ${rooms.filter(r=>r.lenderChatUnread).length}개를 모두 읽음 처리할까요?`)) return;
          const unreadRooms=rooms.filter(r=>r.lenderChatUnread);
          setRooms(prev=>prev.map(r=>r.lenderChatUnread?{...r,lenderChatUnread:false}:r));
          unreadRooms.forEach(room=>{
            fetch('/api/chat/mark-read',{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({chatRoomUuid:room.chatRoomUuid})}).catch(()=>{});
          });
          setTimeout(()=>loadRooms(),500);
        }} disabled={loading||rooms.filter(r=>r.lenderChatUnread).length===0}
          style={{flex:1,fontSize:12,fontWeight:600,padding:"7px 0",borderRadius:8,background:"#EDE9FE",border:"none",cursor:"pointer",color:"#7C3AED",
            opacity:rooms.filter(r=>r.lenderChatUnread).length===0?0.4:1}}>
          모두 읽기
        </button>
        <button onClick={loadRooms} disabled={loading}
          style={{flex:1,fontSize:12,fontWeight:600,padding:"7px 0",borderRadius:8,background:"#EDE9FE",border:"none",cursor:"pointer",color:"#7C3AED"}}>
          {loading?<Loader2 size={12} style={{animation:"spin 1s linear infinite"}}/>:"새로고침"}
        </button>
      </div>
      {chatSortMode==='latest' ? (
        <div>
          {visibleRooms().map(room => renderRoomButton(room, false))}
        </div>
      ) : Object.entries(groupedRooms()).map(([svc,acctGroups])=>{
        const unread=Object.values(acctGroups).flat().filter(r=>r.lenderChatUnread).length;
        const expanded=expandedCategories[svc]!==false;
        return(
          <div key={svc}>
            <button onClick={()=>setExpandedCategories(p=>({...p,[svc]:!expanded}))}
              style={{width:"100%",padding:"10px 16px",display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",
                borderBottom:"1px solid #EDE9FE",fontSize:13,fontWeight:700,color:"#7C3AED",fontFamily:"inherit"}}>
              <ChevronDown size={14} style={{transform:expanded?"rotate(0)":"rotate(-90deg)",transition:"transform 0.2s",flexShrink:0}}/>
              <span style={{flex:1,textAlign:"left"}}>{svc}</span>
              {unread>0&&<span style={{background:"#EF4444",color:"#fff",borderRadius:12,padding:"2px 7px",fontSize:10,fontWeight:700}}>{unread}</span>}
            </button>
            {expanded&&Object.entries(acctGroups).map(([acct,acctRooms])=>{
              const acctKey=`${svc}__${acct}`;
              const acctExpanded=expandedCategories[acctKey]!==false;
              const acctUnread=acctRooms.filter(r=>r.lenderChatUnread).length;
              const allAccts=Object.keys(acctGroups);
              const showSubHeader=!(allAccts.length===1&&allAccts[0]==='(직접전달)');
              return(
                <div key={acct}>
                  {showSubHeader&&(
                    <button onClick={()=>setExpandedCategories(p=>({...p,[acctKey]:!acctExpanded}))}
                      style={{width:"100%",padding:"6px 16px 6px 32px",display:"flex",alignItems:"center",gap:6,
                        background:"#F8F6FF",border:"none",cursor:"pointer",
                        borderBottom:"1px solid #EDE9FE",fontSize:11,fontWeight:600,color:"#9CA3AF",fontFamily:"inherit"}}>
                      <ChevronDown size={11} style={{transform:acctExpanded?"rotate(0)":"rotate(-90deg)",transition:"transform 0.2s",flexShrink:0,color:"#C4B5FD"}}/>
                      <span style={{flex:1,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{acct}</span>
                      <span style={{color:"#C4B5FD",fontSize:10,flexShrink:0}}>{acctRooms.length}명</span>
                      {acctUnread>0&&<span style={{background:"#FCA5A5",color:"#fff",borderRadius:10,padding:"1px 5px",fontSize:9,fontWeight:700,flexShrink:0}}>{acctUnread}</span>}
                    </button>
                  )}
                  {acctExpanded&&acctRooms.map(room=>renderRoomButton(room, showSubHeader))}
                </div>
              );
            })}
          </div>
        );
      })}
      {rooms.length===0&&!loading&&(
        <div style={{textAlign:"center",padding:"48px 20px",color:"#9CA3AF",fontSize:13}}>
          <MessageCircle size={28} color="#C4B5FD" style={{margin:"0 auto 10px"}}/>
          채팅방 없음
        </div>
      )}
    </div>
  );

  // ── 채팅 뷰 ─────────────────────────────────────────────────

  const renderChat = () => {
    if (!selectedRoom) return null;
    return (
      <div style={{flex:1,height:"100%",display:"flex",flexDirection:"column",minWidth:0}}>
        {/* 헤더 */}
        <div style={{padding:"14px 20px",borderBottom:"1px solid #F3F0FF",display:"flex",alignItems:"center",gap:12,flexShrink:0,background:"#fff"}}>
          <button onClick={()=>setSelectedRoom(null)} style={{background:"none",border:"none",cursor:"pointer",padding:4,borderRadius:6,color:"#7C3AED",display:"flex",alignItems:"center",gap:2,fontSize:12,fontWeight:800}}>
            <ChevronLeft size={22}/> {isMobile&&"목록"}
          </button>
          <div style={{width:40,height:40,borderRadius:10,overflow:"hidden",background:"#EDE9FE",flexShrink:0}}>
            <img src={selectedRoom.borrowerThumbnail||''} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}
              onError={(e)=>{(e.target as HTMLImageElement).style.display="none";}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:700,color:"#1E1B4B"}}>{selectedRoom.borrowerName}</div>
            <div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>{selectedRoom.productType} · {selectedRoom.statusName} · {selectedRoom.keepAcct}</div>
          </div>
          {selectedRoom.lenderChatUnread&&<button onClick={()=>markRoomRead(selectedRoom)} style={{background:"#FEF3C7",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,color:"#B45309",fontWeight:800,fontFamily:"inherit"}}>읽음 처리</button>}
          <button onClick={()=>loadMessages(selectedRoom.chatRoomUuid,1)}
            style={{background:"#EDE9FE",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:12,color:"#7C3AED",fontWeight:600,fontFamily:"inherit"}}>
            <RefreshCw size={13}/> {!isMobile&&"새로고침"}
          </button>
        </div>

        {/* 메시지 영역 */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:8,background:"#FAFAFA"}}>
          {hasMore&&(
            <button onClick={loadMore} disabled={msgLoading}
              style={{alignSelf:"center",background:"#F3F0FF",border:"none",borderRadius:10,padding:"8px 18px",
                fontSize:12,color:"#7C3AED",fontWeight:600,cursor:"pointer",fontFamily:"inherit",marginBottom:8,display:"flex",alignItems:"center",gap:4}}>
              {msgLoading?<Loader2 size={12} style={{animation:"spin 1s linear infinite"}}/>:<ArrowDown size={12}/>}
              이전 메시지 더 보기
            </button>
          )}
          {msgLoading&&messages.length===0&&(
            <div style={{textAlign:"center",padding:"30px",color:"#A78BFA"}}>
              <Loader2 size={24} style={{animation:"spin 1s linear infinite",margin:"0 auto"}}/>
            </div>
          )}
          {messages.map((msg,i)=>{
            if(msg.isInfo){
              return(
                <div key={i} style={{alignSelf:"center",background:"#F3F0FF",borderRadius:12,padding:"10px 16px",maxWidth:"80%",textAlign:"center"}}>
                  <div style={{fontSize:12,color:"#6B7280",lineHeight:1.6}} dangerouslySetInnerHTML={{__html:msg.message}}/>
                  <div style={{fontSize:10,color:"#9CA3AF",marginTop:4}}>{msg.registeredDateTime}</div>
                </div>
              );
            }
            const isMe=msg.isOwned;
            return(
              <div key={i} style={{alignSelf:isMe?"flex-end":"flex-start",maxWidth:isMobile?"88%":"60%",display:"flex",flexDirection:"column",gap:4}}>
                <div style={{
                  background:isMe?"#7C3AED":"#fff",
                  color:isMe?"#fff":"#1E1B4B",
                  borderRadius:isMe?"18px 18px 4px 18px":"18px 18px 18px 4px",
                  padding:"12px 16px",
                  boxShadow:isMe?"0 2px 8px rgba(124,58,237,0.2)":"0 1px 4px rgba(0,0,0,0.07)",
                  border:isMe?"none":"1px solid #EDE9FE",
                  fontSize:14,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",
                }} dangerouslySetInnerHTML={{__html:msg.message}}/>
                <div style={{fontSize:10,color:"#9CA3AF",textAlign:isMe?"right":"left",display:"flex",gap:4,justifyContent:isMe?"flex-end":"flex-start",paddingInline:"4px"}}>
                  {msg.registeredDateTime}
                  {isMe&&!msg.isRead&&<span style={{color:"#A78BFA",fontWeight:600}}>·미읽</span>}
                </div>
              </div>
            );
          })}
          <div ref={msgEndRef}/>
        </div>

        {/* 입력 영역 */}
        <div style={{padding:isMobile?"10px 12px calc(12px + env(safe-area-inset-bottom))":"12px 20px 16px",borderTop:"1px solid #EDE9FE",display:"flex",flexDirection:"column",gap:8,flexShrink:0,background:"#fff"}}>
          <button onClick={handleAiReply} disabled={aiLoading||messages.length===0}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%",padding:"10px 0",borderRadius:12,
              background:aiLoading?"#EDE9FE":"linear-gradient(135deg,#818CF8,#A78BFA)",
              border:"none",cursor:aiLoading?"not-allowed":"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,color:"#fff",
              boxShadow:"0 2px 10px rgba(167,139,250,0.3)",opacity:messages.length===0?0.5:1}}>
            {aiLoading?<Loader2 size={15} style={{animation:"spin 1s linear infinite"}}/>:<Sparkles size={15}/>}
            {aiLoading?"AI 답변 생성 중...":"🤖 AI 답변 생성"}
          </button>
          <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
            <textarea
              value={sendText}
              onChange={e=>setSendText(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();}}}
              placeholder="메시지 입력... (Shift+Enter 줄바꿈)"
              rows={sendText.split('\n').length>2?3:2}
              style={{flex:1,padding:"14px 18px",borderRadius:14,border:"1.5px solid #DDD6FE",
                fontSize:15,color:"#1E1B4B",background:"#F8F6FF",outline:"none",fontFamily:"inherit",
                resize:"none",lineHeight:1.5,minHeight:52,maxHeight:140,
                boxSizing:"border-box" as any}}
            />
            <button onClick={handleSend} disabled={!sendText.trim()||sending}
              style={{background:sendText.trim()?"#7C3AED":"#DDD6FE",border:"none",borderRadius:14,
                padding:"0 20px",cursor:sendText.trim()?"pointer":"not-allowed",flexShrink:0,
                display:"flex",alignItems:"center",height:52,transition:"background 0.2s"}}>
              {sending?<Loader2 size={18} color="#fff" style={{animation:"spin 1s linear infinite"}}/>:<Send size={18} color={sendText.trim()?"#fff":"#A78BFA"}/>}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── 메인 레이아웃 ────────────────────────────────────────────

  const mobileChatHidden = isMobile && selectedRoom;
  const sidebar = (
    <div style={{width:isMobile?"100%":sidebarWidth,minWidth:isMobile?"100%":300,maxWidth:isMobile?"100%":640,borderRight:isMobile?"none":"1px solid #EDE9FE",
      display:mobileChatHidden?"none":"flex",flexDirection:"column",background:"#FDFBFF",flexShrink:0,position:"relative"}}>
      <div style={{overflowY:"auto",flexShrink:0}}>
        {renderArPanel()}
        {renderNoticePanel()}
      </div>
      <div style={{flex:1,overflowY:"auto"}}>{renderSidebar()}</div>
      {/* 리사이즈 핸들 */}
      {!isMobile&&<div onMouseDown={()=>setResizing(true)}
        style={{position:"absolute",right:-3,top:0,bottom:0,width:6,cursor:"col-resize",
          background:resizing?"rgba(124,58,237,0.2)":"transparent",zIndex:10,
          transition:"background 0.2s"}}/>}
    </div>
  );

  return (
    <div style={{height:"100vh",display:"flex",background:"#fff",overflow:"hidden",userSelect:resizing?"none":"auto" as any,width:"100%"}}>
      {sidebar}
      {selectedRoom
        ? renderChat()
        : <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#9CA3AF",background:"#FAFAFA"}}>
            <div style={{textAlign:"center"}}>
              <MessageCircle size={56} color="#DDD6FE" style={{margin:"0 auto 16px"}}/>
              <div style={{fontSize:15,color:"#9CA3AF"}}>채팅방을 선택해주세요</div>
            </div>
          </div>
      }
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        button:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}
