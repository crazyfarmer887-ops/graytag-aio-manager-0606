// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAdminAuthFetchPatchForTests, clearAdminToken, installAdminAuthFetchPatch, setAdminToken } from "./src/web/lib/admin-auth";

describe("AIO admin auth frontend fetch patch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    __resetAdminAuthFetchPatchForTests();
  });

  it("stores the token only in localStorage and adds x-admin-token to same-origin mutating API calls", async () => {
    setAdminToken(" secret-token ");

    const originalFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    Object.defineProperty(window, "fetch", { value: originalFetch, writable: true });

    installAdminAuthFetchPatch();
    await fetch("/api/post/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

    expect(window.localStorage.getItem("aio.adminToken")).toBe("secret-token");
    const headers = new Headers(originalFetch.mock.calls[0][1]?.headers);
    expect(headers.get("x-admin-token")).toBe("secret-token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("does not attach the token to safe API reads or external requests", async () => {
    setAdminToken("secret-token");

    const calls: Array<RequestInit | undefined> = [];
    const originalFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init);
      return new Response("{}", { status: 200 });
    });
    Object.defineProperty(window, "fetch", { value: originalFetch, writable: true });

    installAdminAuthFetchPatch();
    await fetch("/api/prices/netflix");
    await fetch("https://example.com/api/post/create", { method: "POST" });

    expect(new Headers(calls[0]?.headers).has("x-admin-token")).toBe(false);
    expect(new Headers(calls[1]?.headers).has("x-admin-token")).toBe(false);
  });

  it("adds x-admin-token to same-origin sensitive GET API reads", async () => {
    setAdminToken("secret-token");

    const originalFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
    Object.defineProperty(window, "fetch", { value: originalFetch, writable: true });

    installAdminAuthFetchPatch();
    await fetch("/api/session/cookies");
    await fetch("/api/chat/rooms", { headers: { Accept: "application/json" } });

    expect(new Headers(originalFetch.mock.calls[0][1]?.headers).get("x-admin-token")).toBe("secret-token");
    const secondHeaders = new Headers(originalFetch.mock.calls[1][1]?.headers);
    expect(secondHeaders.get("x-admin-token")).toBe("secret-token");
    expect(secondHeaders.get("accept")).toBe("application/json");
  });

  it("notifies the user when a protected API returns 403", async () => {
    clearAdminToken();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    const eventSpy = vi.fn();
    window.addEventListener("aio-admin-auth-failure", eventSpy);

    const originalFetch = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 403 }));
    Object.defineProperty(window, "fetch", { value: originalFetch, writable: true });

    installAdminAuthFetchPatch();
    await fetch("/api/post/create", { method: "POST" });

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("AIO 관리자 토큰"));
    expect(eventSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener("aio-admin-auth-failure", eventSpy);
  });
});
