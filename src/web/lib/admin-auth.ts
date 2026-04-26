const ADMIN_TOKEN_STORAGE_KEY = "aio.adminToken";
const AUTH_FAILURE_EVENT="aio-admin-auth-failure";
const ADMIN_REQUIRED_GET_PREFIXES = [
  "/api/session/cookies",
  "/api/session/status",
  "/api/chat/rooms",
  "/api/chat/messages",
  "/api/chat/poll",
  "/api/chat/auto-reply-log",
  "/api/price-safety",
  "/api/audit-log",
  "/api/safe-mode",
  "/api/email-alias-fill",
];

export type AdminAuthFailureDetail = {
  status: 403 | 503;
  message: string;
  url: string;
};

let fetchPatchInstalled = false;
let lastAlertAt = 0;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getAdminToken(): string {
  if (!canUseStorage()) return "";
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function setAdminToken(token: string): void {
  if (!canUseStorage()) return;
  const normalized = token.trim();
  try {
    if (normalized) window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, normalized);
    else window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("[AIO Admin Auth] 토큰 저장 실패", error);
  }
}

export function clearAdminToken(): void {
  setAdminToken("");
}

function apiUrl(input: RequestInfo | URL): URL | null {
  if (typeof window === "undefined") return null;
  try {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    return new URL(rawUrl, window.location.origin);
  } catch {
    return null;
  }
}

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  const url = apiUrl(input);
  return Boolean(url && url.origin === window.location.origin && url.pathname.startsWith("/api/"));
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
}

function isAdminRequiredGetPath(input: RequestInfo | URL): boolean {
  const url = apiUrl(input);
  if (!url) return false;
  return ADMIN_REQUIRED_GET_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

function withAdminToken(input: RequestInfo | URL, init: RequestInit | undefined): RequestInit | undefined {
  if (!isSameOriginApiRequest(input)) return init;

  const method = requestMethod(input, init);
  if ((method === "GET" || method === "HEAD") && !isAdminRequiredGetPath(input)) return init;
  if (method === "OPTIONS") return init;

  const token = getAdminToken();
  if (!token) return init;

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  if (!headers.has("x-admin-token")) headers.set("x-admin-token", token);

  return { ...init, headers };
}

function authFailureMessage(status: 403 | 503): string {
  if (status === 503) {
    return "AIO 관리자 인증이 서버에 설정되지 않았습니다. 운영 서버의 AIO_ADMIN_TOKEN 설정을 확인하세요.";
  }
  return "AIO 관리자 토큰이 필요하거나 올바르지 않습니다. 우측 상단 관리자 토큰 입력란에 토큰을 저장한 뒤 다시 시도하세요.";
}

function notifyAuthFailure(response: Response, input: RequestInfo | URL): void {
  if (response.status !== 403 && response.status !== 503) return;
  if (!isSameOriginApiRequest(input)) return;

  const status = response.status as 403 | 503;
  const detail: AdminAuthFailureDetail = {
    status,
    message: authFailureMessage(status),
    url: apiUrl(input)?.pathname || String(input),
  };

  console.warn(`[AIO Admin Auth] ${detail.message} (${detail.status} ${detail.url})`);
  window.dispatchEvent(new CustomEvent<AdminAuthFailureDetail>(AUTH_FAILURE_EVENT, { detail }));

  const now = Date.now();
  if (now - lastAlertAt > 3000) {
    lastAlertAt = now;
    window.alert(detail.message);
  }
}

export function installAdminAuthFetchPatch(): void {
  if (typeof window === "undefined" || fetchPatchInstalled) return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const patchedInit = withAdminToken(input, init);
    const response = await originalFetch(input, patchedInit);
    notifyAuthFailure(response, input);
    return response;
  };

  fetchPatchInstalled = true;
}

export function __resetAdminAuthFetchPatchForTests(): void {
  fetchPatchInstalled = false;
  lastAlertAt = 0;
}

export function adminAuthFailureEventName(): string {
  return AUTH_FAILURE_EVENT;
}
