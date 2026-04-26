import type { ReactNode } from "react";

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 18px", color: "var(--text-muted)", background: "var(--surface-raised)", border: "1.5px dashed var(--border)", borderRadius: 18 }}>
      {icon && <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--foreground)", marginBottom: 5 }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{description}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
