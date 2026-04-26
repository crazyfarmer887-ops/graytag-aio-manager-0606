import type { CSSProperties, ReactNode } from "react";

export function Card({ children, tone = "default", style }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info"; style?: CSSProperties }) {
  const borderByTone = {
    default: "var(--border)",
    success: "rgba(16, 185, 129, 0.28)",
    warning: "rgba(245, 158, 11, 0.32)",
    danger: "rgba(239, 68, 68, 0.30)",
    info: "rgba(59, 130, 246, 0.28)",
  } as const;
  return (
    <section
      style={{
        background: "var(--surface-raised)",
        border: `1.5px solid ${borderByTone[tone]}`,
        borderRadius: 18,
        boxShadow: "var(--shadow-card)",
        padding: 14,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function StatCard({ label, value, helper, tone = "default" }: { label: string; value: ReactNode; helper?: ReactNode; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  return (
    <Card tone={tone} style={{ padding: "12px 13px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: "var(--foreground)", lineHeight: 1.1 }}>{value}</div>
      {helper && <div style={{ fontSize: 10, color: "var(--text-subtle)", marginTop: 6, lineHeight: 1.35 }}>{helper}</div>}
    </Card>
  );
}
