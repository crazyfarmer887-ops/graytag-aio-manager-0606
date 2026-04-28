export type ProfileNicknameCategory = 'animal' | 'fruit';

export interface ProfileNicknameDictionaryItem {
  name: string;
  category: ProfileNicknameCategory;
}

export const PROFILE_NICKNAME_DICTIONARY: ProfileNicknameDictionaryItem[] = [
  { name: '고양이', category: 'animal' },
  { name: '강아지', category: 'animal' },
  { name: '다람쥐', category: 'animal' },
  { name: '고슴도치', category: 'animal' },
  { name: '너구리', category: 'animal' },
  { name: '수달이', category: 'animal' },
  { name: '토끼야', category: 'animal' },
  { name: '사슴이', category: 'animal' },
  { name: '코알라', category: 'animal' },
  { name: '판다곰', category: 'animal' },
  { name: '여우비', category: 'animal' },
  { name: '햄스터', category: 'animal' },
  { name: '돌고래', category: 'animal' },
  { name: '참새랑', category: 'animal' },
  { name: '고래별', category: 'animal' },
  { name: '하마랑', category: 'animal' },
  { name: '치타별', category: 'animal' },
  { name: '알파카', category: 'animal' },
  { name: '라마야', category: 'animal' },
  { name: '기린이', category: 'animal' },
  { name: '바나나', category: 'fruit' },
  { name: '복숭아', category: 'fruit' },
  { name: '파인애플', category: 'fruit' },
  { name: '블루베리', category: 'fruit' },
  { name: '딸기잼', category: 'fruit' },
  { name: '망고링', category: 'fruit' },
  { name: '사과별', category: 'fruit' },
  { name: '자두잼', category: 'fruit' },
  { name: '포도알', category: 'fruit' },
  { name: '레몬톡', category: 'fruit' },
  { name: '라임톡', category: 'fruit' },
  { name: '체리봉', category: 'fruit' },
  { name: '멜론볼', category: 'fruit' },
  { name: '감귤이', category: 'fruit' },
  { name: '키위새', category: 'fruit' },
  { name: '수박씨', category: 'fruit' },
  { name: '살구빛', category: 'fruit' },
  { name: '오렌지', category: 'fruit' },
  { name: '무화과', category: 'fruit' },
  { name: '유자청', category: 'fruit' },
];

export interface ProfileAssignment {
  id: string;
  productUsids: string[];
  serviceType: string;
  accountEmail: string;
  emailAliasId: number | string | null;
  emailAlias: string;
  profileNickname: string;
  status: 'active' | 'ended';
  warningCount: number;
  createdAt: string;
  updatedAt: string;
}

export function generateProfileNickname(random = Math.random): string {
  const index = Math.min(PROFILE_NICKNAME_DICTIONARY.length - 1, Math.floor(random() * PROFILE_NICKNAME_DICTIONARY.length));
  return PROFILE_NICKNAME_DICTIONARY[index]?.name || PROFILE_NICKNAME_DICTIONARY[0].name;
}

export function normalizeProfileNickname(value: string): string {
  return value.replace(/[^가-힣]/g, '').slice(0, 4);
}

export function isValidProfileNickname(value: string): boolean {
  const length = Array.from(normalizeProfileNickname(value)).length;
  return length >= 3 && length <= 4;
}

export function buildProfileWarningMemo(profileNickname: string, baseMemo: string): string {
  const nickname = isValidProfileNickname(profileNickname) ? normalizeProfileNickname(profileNickname) : generateProfileNickname(() => 0);
  const warning = `⚠️ 1인 1프로필 원칙 안내\n\n배정 프로필: ${nickname}\n\n접속 후 반드시 위 프로필명으로 직접 만들어서 사용해주세요.\n다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다.\n프로필명이 없거나 접속이 안 되면 임의로 새로 만들지 말고 판매자 채팅으로 먼저 문의해주세요.`;
  const stripped = baseMemo.replace(/^⚠️ 1인 1프로필 원칙 안내[\s\S]*?(?=아래 내용 꼭 읽어주세요!|로그인 시도 간|https:\/\/email-verify\.xyz|$)/, '').trimStart();
  return `${warning}\n\n${stripped}`.trim();
}

export function buildProfileAssignment(input: {
  productUsids: string[];
  serviceType: string;
  accountEmail: string;
  emailAliasId?: number | string | null;
  emailAlias?: string;
  profileNickname: string;
  now?: string;
}): ProfileAssignment {
  const now = input.now || new Date().toISOString();
  const nickname = isValidProfileNickname(input.profileNickname) ? normalizeProfileNickname(input.profileNickname) : generateProfileNickname(() => 0);
  return {
    id: `${input.emailAliasId ?? input.accountEmail}:${nickname}`,
    productUsids: input.productUsids.filter(Boolean),
    serviceType: input.serviceType.trim(),
    accountEmail: input.accountEmail.trim(),
    emailAliasId: input.emailAliasId ?? null,
    emailAlias: input.emailAlias?.trim() || '',
    profileNickname: nickname,
    status: 'active',
    warningCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
