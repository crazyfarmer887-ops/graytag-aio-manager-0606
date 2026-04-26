import { useEffect, useState } from "react";
import {
  adminAuthFailureEventName,
  clearAdminToken,
  getAdminToken,
  setAdminToken,
  type AdminAuthFailureDetail,
} from "../lib/admin-auth";

export default function AdminTokenControl() {
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [message, setMessage] = useState("관리자 보호 기능 사용 시 토큰을 저장하세요.");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = getAdminToken();
    setHasToken(Boolean(saved));
    setOpen(!saved);

    const onAuthFailure = (event: Event) => {
      const detail = (event as CustomEvent<AdminAuthFailureDetail>).detail;
      setMessage(detail?.message || "AIO 관리자 토큰 확인이 필요합니다.");
      setOpen(true);
    };

    window.addEventListener(adminAuthFailureEventName(), onAuthFailure);
    return () => window.removeEventListener(adminAuthFailureEventName(), onAuthFailure);
  }, []);

  const save = () => {
    setAdminToken(token);
    const saved = Boolean(getAdminToken());
    setHasToken(saved);
    setToken("");
    setMessage(saved ? "관리자 토큰이 이 브라우저에 저장되었습니다." : "토큰을 입력하세요.");
    if (saved) setOpen(false);
  };

  const remove = () => {
    clearAdminToken();
    setHasToken(false);
    setToken("");
    setMessage("저장된 관리자 토큰을 삭제했습니다.");
    setOpen(true);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        zIndex: 1000,
        maxWidth: 360,
        fontSize: 12,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 999,
            background: hasToken ? "#ecfdf5" : "#fff7ed",
            color: hasToken ? "#047857" : "#c2410c",
            padding: "6px 10px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
          title="AIO 관리자 토큰은 서버/HTML에 노출되지 않고 현재 브라우저 localStorage에만 저장됩니다."
        >
          {hasToken ? "관리자 토큰 저장됨" : "관리자 토큰 필요"}
        </button>
      ) : (
        <div
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 12,
            background: "rgba(255,255,255,0.98)",
            color: "#111827",
            padding: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <strong>AIO 관리자 토큰</strong>
            <button type="button" onClick={() => setOpen(false)} aria-label="닫기" style={{ border: 0, background: "transparent", cursor: "pointer" }}>
              ×
            </button>
          </div>
          <p style={{ margin: "8px 0", lineHeight: 1.35 }}>{message}</p>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
            placeholder="AIO admin token"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={save} style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "white" }}>
              저장
            </button>
            <button type="button" onClick={remove} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "white" }}>
              삭제
            </button>
          </div>
          <div style={{ marginTop: 8, color: "#6b7280" }}>
            토큰은 현재 브라우저 localStorage에만 저장됩니다.
          </div>
        </div>
      )}
    </div>
  );
}
