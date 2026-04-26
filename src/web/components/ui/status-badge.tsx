import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "info" | "muted";

const toneStyles: Record<StatusTone, { color: string; background: string; border: string }> = {
  success: { color: "var(--success)", background: "var(--success-bg)", border: "rgba(16,185,129,.24)" },
  warning: { color: "var(--warning)", background: "var(--warning-bg)", border: "rgba(245,158,11,.28)" },
  danger: { color: "var(--danger)", background: "var(--danger-bg)", border: "rgba(239,68,68,.26)" },
  info: { color: "var(--info)", background: "var(--info-bg)", border: "rgba(59,130,246,.24)" },
  muted: { color: "var(--text-muted)", background: "#F3F4F6", border: "#E5E7EB" },
};

export function StatusBadge({ children, tone = "muted" }: { children: ReactNode; tone?: StatusTone }) {
  const s = toneStyles[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "3px 8px", fontSize: 10, fontWeight: 900, color: s.color, background: s.background, border: `1px solid ${s.border}`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}
