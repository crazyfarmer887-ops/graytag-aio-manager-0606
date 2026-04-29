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
  assert.match(home, /파티 재정비 대상/);
  assert.match(home, /완료한 파티 재정비 대상/);
  assert.match(home, /해당 계정으로 또 다시 파티 모집을 진행할건가/);
  assert.match(home, /기존 구독이 유지됐는가/);
  assert.match(home, /구독 결제일은 매달 몇일인가/);
  assert.match(home, /subscriptionBillingDay/);
  assert.match(home, /랜덤 12자리 비밀번호 생성/);
  assert.match(home, /변경 예정 비밀번호/);
  assert.match(home, /PIN 번호를 변경했는가/);
  assert.match(home, /변경된 PIN/);
  assert.match(home, /PIN 변경 확인됨/);
  assert.match(home, /이메일 새탭 열기/);
  assert.match(home, /기존 파티원 프로필을 제거했는가/);
  assert.match(home, /구독을 해지했는가/);
  assert.match(home, /파티 재시작 YES 시 완료 탭으로 이동/);
  assert.match(home, /splitPartyMaintenanceChecklistItems\(items\)/);
  assert.match(home, /대상 복귀/);
  assert.match(home, /이용중 0명|7일 이내 만료/);
  assert.match(home, /buildPartyMaintenanceTargets\(data/);
  assert.match(home, /party-maintenance-checklists/);
  const write = read('src/web/pages/write.tsx');
  assert.match(write, /재정비 DB 자동 불러오기/);
  assert.match(write, /findMaintenanceCredentialForAlias/);
  assert.match(write, /maintenanceCredentialStore/);
  assert.match(write, /setKeepPasswd\(credential\.password\)/);
  assert.match(write, /setKeepPasswd\(''\)/);
  assert.match(write, /랜덤 프로필명/);
  assert.match(write, /profileNickname/);
  assert.match(write, /buildProfileWarningMemo/);
  assert.match(write, /profile-assignments/);
  assert.match(write, /⚠️ 1인 1프로필 원칙 안내/);
  assert.doesNotMatch(home, /최근 만료 파티 체크리스트/);
  assert.doesNotMatch(home, /expired-party-checklists/);
  assert.match(home, /실시간 채팅 알림/);
  assert.match(home, /안 읽은 문의 내용/);
  assert.match(home, /메시지 도착/);
  assert.match(home, /계정/);
  assert.match(home, /내용 확인 필요/);
  assert.match(home, /캐시 표시중/);
  assert.match(home, /rateLimited/);
  assert.match(home, /messageHydrationFailedCount/);
  assert.match(home, /buildUnreadChatAlerts\(json\.rooms \|\| \[\], 5\)/);
  assert.match(home, /buildChatAlerts\(json\.rooms \|\| \[\], 5\)/);
  assert.match(home, /fetch\('\/api\/chat\/rooms'\)/);
  const chat = read('src/web/pages/chat.tsx');
  assert.match(chat, /isMobile/);
  assert.match(chat, /안읽음만 보기/);
  assert.match(chat, /읽음 처리/);
  assert.match(chat, /목록/);
  assert.match(chat, /mobileChatHidden/);
  assert.match(home, /buildServiceStats\(data, manuals\)/);
  assert.match(nav, /운영/);
  assert.match(nav, /자동화/);
  assert.match(admin, /인증됨|잠김|오류/);
  const manage = read('src/web/pages/manage.tsx');
  assert.match(manage, /프로필 수 검증/);
  assert.match(manage, /검증 진척도/);
  assert.match(manage, /profile-audit\/progress/);
  assert.match(manage, /실제 \/ 관리/);
  assert.match(manage, /findExactPasswordForAccount/);
  assert.match(manage, /requireExactAliasMemoForAutoFill/);
  assert.match(manage, /전체 메꾸기 미리보기 필요/);
  assert.match(manage, /계정 생성/);
  assert.match(manage, /Email 대시보드 alias/);
  assert.match(manage, /generated-accounts\/create/);
  assert.match(manage, /생성만 완료/);
  assert.match(manage, /결제 완료/);
  assert.match(manage, /판매 게시물 없이도 계정 관리에 유지/);
  assert.match(manage, /방금 생성한 계정 삭제/);
  assert.match(manage, /method:'DELETE'/);
  assert.match(manage, /handleDeleteGeneratedAccount/);
  assert.match(read('src/api/index.ts'), /app\.delete\('\/generated-accounts\/:id'/);
  assert.match(read('src/api/index.ts'), /createSimpleLoginCustomAlias/);
  assert.doesNotMatch(read('src/api/index.ts'), /graytag-account-generator/);
  assert.match(read('src/api/index.ts'), /nextGeneratedAliasPrefix/);
  assert.match(read('src/api/index.ts'), /api\/v2\/alias\/custom\/new/);
  assert.match(read('src/api/index.ts'), /DELETE.*api\/aliases/);
  assert.match(read('src/api/index.ts'), /mergeGeneratedAccountsIntoManagement/);
  assert.doesNotMatch(manage, /ANY product with a password from ANY account/);
});
