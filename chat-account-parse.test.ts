import { test, expect } from 'vitest';

// ─── 구현 ───
export function parseDeliveredAccountFromMessages(messages: Array<{
  message: string;
  isOwned: boolean;
  isInfo: boolean;
}>): string | null {
  for (const msg of messages) {
    if (!msg.isOwned || msg.isInfo) continue;
    const text = msg.message
      .replace(/&#64;/g, '@')
      .replace(/<br\s*\/?>\s*/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const match = text.match(/아이디\s*:\s*([^\s\n<]+)/);
    if (match) return match[1].trim();
  }
  return null;
}

// ─── 테스트 ───

test('아이디 : email 패턴에서 이메일 추출', () => {
  const messages = [
    { message: '김찬님이 결제하셨습니다.', isOwned: false, isInfo: true },
    { message: '아이디 : netflix4.animate690@aleeas.com<br />비밀번호 : Zxcx!!8520<br />', isOwned: true, isInfo: false },
  ];
  expect(parseDeliveredAccountFromMessages(messages)).toBe('netflix4.animate690@aleeas.com');
});

test('HTML 엔티티 &#64; → @ 변환 후 추출', () => {
  const messages = [
    { message: '아이디 : netflix4.animate690&#64;aleeas.com<br />비밀번호 : abc', isOwned: true, isInfo: false },
  ];
  expect(parseDeliveredAccountFromMessages(messages)).toBe('netflix4.animate690@aleeas.com');
});

test('isOwned=false 메시지는 무시', () => {
  const messages = [
    { message: '아이디 : someone@example.com', isOwned: false, isInfo: false },
  ];
  expect(parseDeliveredAccountFromMessages(messages)).toBeNull();
});

test('isInfo=true 메시지는 무시', () => {
  const messages = [
    { message: '아이디 : someone@example.com', isOwned: true, isInfo: true },
  ];
  expect(parseDeliveredAccountFromMessages(messages)).toBeNull();
});

test('계정 정보 메시지가 없으면 null', () => {
  const messages = [
    { message: '안녕하세요', isOwned: true, isInfo: false },
    { message: '계정 정보가 전달되었습니다.', isOwned: false, isInfo: true },
  ];
  expect(parseDeliveredAccountFromMessages(messages)).toBeNull();
});

test('빈 배열이면 null', () => {
  expect(parseDeliveredAccountFromMessages([])).toBeNull();
});

test('아이디: (공백없이 콜론) 패턴도 지원', () => {
  const messages = [
    { message: '아이디: netflix4.animate690@aleeas.com\n비밀번호: Zxcx!!8520', isOwned: true, isInfo: false },
  ];
  expect(parseDeliveredAccountFromMessages(messages)).toBe('netflix4.animate690@aleeas.com');
});
