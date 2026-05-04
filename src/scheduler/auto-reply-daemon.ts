type EnvLike = Record<string, string | undefined>;

export function autoReplyDaemonEnabled(env: EnvLike = process.env): boolean {
  return env.AUTO_REPLY_DAEMON_ENABLED === 'true';
}

export function autoReplyDaemonIntervalMs(env: EnvLike = process.env): number {
  const raw = Number(env.AUTO_REPLY_DAEMON_INTERVAL_MS || 10 * 60 * 1000);
  if (!Number.isFinite(raw)) return 10 * 60 * 1000;
  return Math.max(10000, Math.min(10 * 60 * 1000, Math.floor(raw)));
}

export function startAutoReplyDaemon(port: number): void {
  if (!autoReplyDaemonEnabled()) {
    console.log('[AutoReplyDaemon] 비활성화됨');
    return;
  }
  const token = String(process.env.AIO_ADMIN_TOKEN || '').trim();
  if (!token) {
    console.warn('[AutoReplyDaemon] AIO_ADMIN_TOKEN 없음 — 시작하지 않음');
    return;
  }
  const intervalMs = autoReplyDaemonIntervalMs();
  const run = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/chat/auto-reply/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ dryRun: process.env.AUTO_REPLY_DAEMON_DRY_RUN !== 'false', maxRooms: Number(process.env.AUTO_REPLY_DAEMON_MAX_ROOMS || 10) }),
      });
      if (!res.ok) console.warn('[AutoReplyDaemon] tick 실패:', res.status);
    } catch (e: any) {
      console.warn('[AutoReplyDaemon] tick 예외:', e?.message || e);
    }
  };
  setTimeout(() => {
    console.log(`[AutoReplyDaemon] 시작됨 (${intervalMs}ms 간격)`);
    run();
    setInterval(run, intervalMs);
  }, 10000);
}
