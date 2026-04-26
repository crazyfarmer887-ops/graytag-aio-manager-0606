// ─── 자정 자동 가격 동기화 (KST 00:00) ──────────────────────

export function scheduleAutoSync(port: number): void {
  function schedule() {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstMidnight = new Date(kstNow);
    kstMidnight.setUTCHours(0, 0, 0, 0);
    kstMidnight.setUTCDate(kstMidnight.getUTCDate() + 1);
    const utcMidnightKST = new Date(kstMidnight.getTime() - 9 * 60 * 60 * 1000);
    const msUntilMidnight = utcMidnightKST.getTime() - now.getTime();

    console.log(`[AutoSync] 다음 실행: KST ${kstMidnight.toISOString()} (${Math.round(msUntilMidnight / 60000)}분 후)`);

    setTimeout(async () => {
      console.log('[AutoSync] 자정 가격 동기화 시작...');
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const adminToken = process.env.AIO_ADMIN_TOKEN?.trim();
        if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
        const resp = await fetch(`http://localhost:${port}/api/auto-sync-prices`, {
          method: 'POST',
          headers,
          body: '{}',
        });
        const result = await resp.json() as any;
        console.log(`[AutoSync] 완료: ${result.updated || 0}개 변경, ${result.skipped || 0}개 스킵`);
      } catch (e: any) {
        console.error('[AutoSync] 에러:', e.message);
      }
      schedule();
    }, msUntilMidnight);
  }

  schedule();
  console.log('[AutoSync] 자정 자동 가격 동기화 스케줄러 시작됨');
}
