import { test, expect } from 'vitest';

// sanitizeForGraytag 함수 (아직 구현 안 됨 — RED)
function sanitizeForGraytag(text: string): string {
  return text.replace(/[\u{10000}-\u{10FFFF}]/gu, "⚠️");
}

// ✅ U+2705 (3바이트 BMP) → 그대로
test('3바이트 이모지 ✅ 는 그대로 통과', () => {
  expect(sanitizeForGraytag('✅ 확인')).toBe('✅ 확인');
});

// 🎬 U+1F3AC (4바이트 SMP) → ⚠️
test('4바이트 이모지 🎬 는 ⚠️ 로 대체', () => {
  expect(sanitizeForGraytag('🎬 성인인증')).toBe('⚠️ 성인인증');
});

// 🔞 U+1F51E (4바이트 SMP) → ⚠️
test('4바이트 이모지 🔞 는 ⚠️ 로 대체', () => {
  expect(sanitizeForGraytag('🔞 성인인증 🔞')).toBe('⚠️ 성인인증 ⚠️');
});

// 혼합
test('3바이트 유지 + 4바이트 대체 혼합', () => {
  const result = sanitizeForGraytag('✅ 확인\n🎬 성인인증은 🎬');
  expect(result).toBe('✅ 확인\n⚠️ 성인인증은 ⚠️');
});

// 이모지 없음
test('이모지 없으면 원문 그대로', () => {
  expect(sanitizeForGraytag('일반 텍스트 테스트')).toBe('일반 텍스트 테스트');
});

// 실제 keepMemo 전체 텍스트
test('실제 keepMemo: 4바이트만 대체, 나머지 유지', () => {
  const input = '✅ 아래 내용 꼭 읽어주세요! ✅\n이메일 코드\n\n🎬 성인인증 🎬\n즐거운 시청!';
  const result = sanitizeForGraytag(input);
  expect(result).toContain('✅');
  expect(result).not.toContain('🎬');
  expect(result).toContain('⚠️');
  expect(result).toContain('즐거운 시청!');
});
