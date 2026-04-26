import type { ReactNode } from "react";

export function PageShell({ title, subtitle, actions, status, children, maxWidth = 480 }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; status?: ReactNode; children: ReactNode; maxWidth?: number }) {
  return (
    <main style={{ maxWidth, margin: "0 auto", minHeight: "100vh", background: "var(--background)", padding: "16px 14px 80px" }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: "var(--foreground)", margin: 0, letterSpacing: -0.5 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "5px 0 0", lineHeight: 1.45 }}>{subtitle}</p>}
          {status && <div style={{ marginTop: 8 }}>{status}</div>}
        </div>
        {actions && <div style={{ flexShrink: 0, display: "flex", gap: 8 }}>{actions}</div>}
      </header>
      {children}
    </main>
  );
}
