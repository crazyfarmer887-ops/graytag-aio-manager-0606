// ─── 서버 사이드 Auto Undercutter 스케줄러 ──────────────────
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const STATE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/undercutter-state.json';

function loadState() {
  try {
    if (!existsSync(STATE_PATH)) return { on: false, intervalMinutes: 5, lastRun: null };
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch { return { on: false, intervalMinutes: 5, lastRun: null }; }
}

function saveState(s: any) {
  try {
    const dir = STATE_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
  } catch {}
}

export function startUndercutterScheduler(port: number): void {
  let ucTimer: ReturnType<typeof setInterval> | null = null;
  // 초기 상태 로드 — 중복 타이머 방지
  const initState = loadState();
  let lastOn = initState.on;
  let lastInterval = initState.intervalMinutes;

  function applyState(state: any) {
    if (ucTimer) { clearInterval(ucTimer); ucTimer = null; }
    if (!state.on) {
      console.log('[ServerUndercutter] OFF — 스케줄러 중지');
      return;
    }
    const ms = (state.intervalMinutes || 5) * 60 * 1000;
    console.log(`[ServerUndercutter] ON — ${state.intervalMinutes}분마다 자동 실행`);
    ucTimer = setInterval(async () => {
      const s = loadState();
      if (!s.on) return;
      try {
        const adminToken = process.env.AIO_ADMIN_TOKEN?.trim();
        const headers = adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined;
        const resp = await fetch(`http://localhost:${port}/api/auto-undercutter/run`, { method: 'POST', headers });
        const result = await resp.json() as any;
        const updated = (result.results || []).filter((r: any) => r.action === 'updated').length;
        console.log(`[ServerUndercutter] 완료: ${updated}개 카테고리 인하`);
        const cur = loadState();
        cur.lastRun = new Date().toISOString();
        saveState(cur);
      } catch (e: any) {
        console.error('[ServerUndercutter] 에러:', e.message);
      }
    }, ms);
  }

  // 초기 상태 적용 (한 번만)
  if (initState.on) {
    applyState(initState);
    console.log(`[ServerUndercutter] 재시작 복원: ON — ${initState.intervalMinutes}분마다`);
  } else {
    console.log('[ServerUndercutter] OFF 상태 — 10초마다 상태 확인 중');
  }

  // 10초마다 상태 변화 감지
  setInterval(() => {
    const state = loadState();
    const changed = state.on !== lastOn || state.intervalMinutes !== lastInterval;
    if (!changed) return;
    lastOn = state.on;
    lastInterval = state.intervalMinutes;
    applyState(state);
  }, 10000);

  console.log('[ServerUndercutter] 초기화 완료');
}
