import { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 16 }}>
        <AlertTriangle size={40} color="#EF4444" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1E1B4B", marginBottom: 6 }}>화면 오류 발생</div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 2 }}>
            {this.state.error?.message || "알 수 없는 오류"}
          </div>
          {this.state.error?.stack && (
            <pre style={{ fontSize: 10, color: "#6B7280", background: "#F9FAFB", borderRadius: 8, padding: "8px 12px", marginTop: 8, textAlign: "left", maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error.stack.split("\n").slice(0,5).join("\n")}
            </pre>
          )}
        </div>
        <button
          onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#A78BFA", color: "#fff", border: "none", borderRadius: 12, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          <RefreshCw size={14} /> 다시 시도
        </button>
      </div>
    );
  }
}
