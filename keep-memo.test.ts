import { test, expect } from 'vitest';

// makeDefaultKeepMemo 함수 (수정 후)
function makeDefaultKeepMemo(emailId?: number|string, pin?: string): string {
  const eid = emailId || '{EMAIL_ID}';
  const p = pin || '{PIN}';
  return `아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!!\n로그인 시도 간 필요한 이메일 코드는 아래 사이트에서 언제든지 셀프인증 가능합니다!\nhttps://email-verify.xyz/email/mail/${eid}\n사이트에서 필요한 핀번호는 : ${p}입니다!\n\n프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!\n만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다! 예)홍길동 또는 홍*동\n만약, 접속 시 기본 프로필 1개만  있거나 자리가 꽉 찼는데 기본 프로필이 있다면 그걸 먼저 수정하고 사용하시면 되겠습니다!\n\n성인인증은 필요하시면 직접 하셔야 합니다!\n\n즐거운 시청되세요!`;
}

test('keepMemo does not contain emoji characters', () => {
  const memo = makeDefaultKeepMemo(41658495, '8888');
  const emojiRegex = /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u2714\u2705\u274C\u274E]/gu;
  expect(memo).not.toMatch(emojiRegex);
});

test('keepMemo contains email-verify URL with emailId', () => {
  const memo = makeDefaultKeepMemo(41658495, '8888');
  expect(memo).toContain('https://email-verify.xyz/email/mail/41658495');
});

test('keepMemo contains pin value', () => {
  const memo = makeDefaultKeepMemo(41658495, '8888');
  expect(memo).toContain('8888');
});

test('keepMemo uses placeholder when emailId not provided', () => {
  const memo = makeDefaultKeepMemo();
  expect(memo).toContain('{EMAIL_ID}');
  expect(memo).toContain('{PIN}');
});
