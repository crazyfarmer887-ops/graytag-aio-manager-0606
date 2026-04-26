import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Home, BarChart2, PenLine, LayoutGrid, User, Calculator, MessageCircle, Settings2, Info, Menu, X } from "lucide-react";

const navGroups = [
  { label: "홈", items: [{ path: "/", label: "홈", Icon: Home }] },
  { label: "운영", items: [
    { path: "/manage",     label: "관리",    Icon: LayoutGrid },
    { path: "/party-info", label: "파티정보", Icon: Info },
    { path: "/edit-price", label: "게시물",  Icon: Settings2 },
  ] },
  { label: "수익", items: [
    { path: "/profit",     label: "수익",    Icon: Calculator },
    { path: "/price",      label: "가격",    Icon: BarChart2 },
  ] },
  { label: "자동화", items: [
    { path: "/write",      label: "글 작성", Icon: PenLine },
    { path: "/chat",       label: "채팅",    Icon: MessageCircle },
  ] },
  { label: "설정", items: [{ path: "/my", label: "내계정", Icon: User }] },
];

const tabs = navGroups.flatMap(group => group.items);

export default function BottomNav() {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => { setOpen(false); }, [location]);

  const isActive = (path: string) => location === path || (path !== "/" && location.startsWith(path));
  const currentTab = tabs.find(t => isActive(t.path));

  return (
    <>
      {/* 상단 바 */}
      <div style={{
        position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 480, zIndex: 200,
        background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid #EDE9FE',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
      }}>
        <button onClick={() => setOpen(!open)} style={{
          background: open ? '#F3F0FF' : 'none', border: 'none', cursor: 'pointer',
          padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8, transition: 'background 0.15s',
        }}>
          {open
            ? <X size={22} color="#7C3AED" strokeWidth={2.5} />
            : <Menu size={22} color="#7C3AED" strokeWidth={2.5} />
          }
        </button>
        {currentTab && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <currentTab.Icon size={16} color="#A78BFA" strokeWidth={2.5} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1E1B4B' }}>{currentTab.label}</span>
          </div>
        )}
      </div>

      {/* 오버레이 */}
      <div
        ref={backdropRef}
        onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
        style={{
          position: 'fixed', inset: 0, zIndex: 299,
          background: 'rgba(0,0,0,0.3)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
      />

      {/* 드로어 */}
      <div style={{
        position: 'fixed', top: 0, left: 0,
        width: 270, maxWidth: '75vw',
        height: '100dvh',
        zIndex: 300,
        background: '#fff',
        boxShadow: open ? '4px 0 24px rgba(0,0,0,0.1)' : 'none',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        overflowY: 'auto',
      }}>
        {/* 드로어 헤더 */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid #F3F0FF',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1E1B4B', letterSpacing: -0.5 }}>메뉴</div>
          <button onClick={() => setOpen(false)} style={{
            background: '#F3F0FF', border: 'none', cursor: 'pointer',
            padding: 5, borderRadius: 8, display: 'flex', alignItems: 'center',
          }}>
            <X size={18} color="#7C3AED" />
          </button>
        </div>

        {/* 메뉴 목록 */}
        <div style={{ padding: '8px 10px', flex: 1 }}>
          {navGroups.map(group => (
            <div key={group.label} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#A78BFA', padding: '8px 10px 5px', letterSpacing: '0.04em' }}>{group.label}</div>
              {group.items.map(({ path, label, Icon }) => {
                const active = isActive(path);
                const isWrite = path === '/write';
                return (
                  <button key={path} onClick={() => { navigate(path); setOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '11px 14px', marginBottom: 2,
                background: active ? '#F3F0FF' : 'transparent',
                border: 'none', borderRadius: 12, cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.15s',
              }}>
                {isWrite ? (
                  <div style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: active
                      ? 'linear-gradient(135deg, #7C3AED, #6D28D9)'
                      : 'linear-gradient(135deg, #A78BFA, #818CF8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(167,139,250,0.3)',
                    flexShrink: 0,
                  }}>
                    <Icon size={16} color="#fff" strokeWidth={2.5} />
                  </div>
                ) : (
                  <div style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: active ? '#EDE9FE' : '#F8F6FF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={16} color={active ? '#7C3AED' : '#9CA3AF'} strokeWidth={active ? 2.5 : 2} />
                  </div>
                )}
                <span style={{
                  fontSize: 14, fontWeight: active ? 700 : 500,
                  color: active ? '#7C3AED' : '#374151',
                }}>{label}</span>
                {active && (
                  <div style={{
                    marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%',
                    background: '#A78BFA',
                  }} />
                )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
