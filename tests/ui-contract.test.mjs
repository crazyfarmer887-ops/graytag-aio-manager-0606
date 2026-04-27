import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

test('shared UI primitives exist for dashboard pages', () => {
  for (const file of [
    'src/web/components/ui/page-shell.tsx',
    'src/web/components/ui/card.tsx',
    'src/web/components/ui/status-badge.tsx',
    'src/web/components/ui/empty-state.tsx',
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }
});

test('global tokens include semantic dashboard states', () => {
  const css = read('src/web/styles.css');
  for (const token of ['--success', '--warning', '--danger', '--info', '--surface-raised', '--text-muted']) {
    assert.match(css, new RegExp(token.replace('--', '--')), `${token} token should exist`);
  }
});

test('OTT home and navigation use the refreshed UI structure', () => {
  const home = read('src/web/pages/home.tsx');
  const nav = read('src/web/components/bottom-nav.tsx');
  const admin = read('src/web/components/admin-token-control.tsx');
  assert.match(home, /오늘 상태/);
  assert.match(home, /위험 알림/);
  assert.match(home, /바로가기/);
  assert.match(home, /만료된 파티 현황/);
  assert.match(home, /buildServiceStats\(data, manuals\)/);
  assert.match(nav, /운영/);
  assert.match(nav, /자동화/);
  assert.match(admin, /인증됨|잠김|오류/);
});
