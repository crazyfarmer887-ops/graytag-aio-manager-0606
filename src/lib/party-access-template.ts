export const PARTY_ACCESS_URL_PLACEHOLDER = '{계정 접근 토큰 생성 주소}';

export function buildPartyAccessDeliveryTemplate(accessUrl = PARTY_ACCESS_URL_PLACEHOLDER): string {
  const url = String(accessUrl || PARTY_ACCESS_URL_PLACEHOLDER).trim() || PARTY_ACCESS_URL_PLACEHOLDER;
  return `✅ 계정 접근 주소 : ${url} ✅

✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!! ✅
계정 정보에 필요한 모든 것은 위에 올려드린 링크를 통해 접근하실 수 있습니다. 이메일 인증은 링크 안에 적힌 핀번호를 이용해서 접근하실 수 있으십니다.

기타 문의사항은 연락 주시면 감사하겠습니다.`;
}
