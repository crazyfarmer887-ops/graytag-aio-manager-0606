import { existsSync, readFileSync } from 'node:fs';

export interface EmailAliasCandidate {
  id: number | string;
  email: string;
  enabled?: boolean;
}

export interface EmailAliasFillResult {
  ok: boolean;
  found: boolean;
  email: string;
  serviceType: string;
  emailId: number | string | null;
  pin: string | null;
  memo: string;
  missing: Array<'email' | 'pin'>;
  message?: string;
}

type PinRecord = { pin?: string; updatedAt?: string };

const DEFAULT_PIN_STORE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-email-verify-dashboard-5588/data/alias-pins.json';

function pinStorePath() {
  return process.env.EMAIL_ALIAS_PIN_STORE_PATH || DEFAULT_PIN_STORE_PATH;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function serviceKeywords(serviceType: string): string[] {
  const normalized = serviceType.toLowerCase();
  const pairs: Array<[RegExp, string[]]> = [
    [/디즈니|disney/, ['disney']],
    [/넷플릭스|netflix/, ['netflix']],
    // TVING seats are backed by the Wavve+TVING bundle aliases in this dashboard.
    [/티빙|티방|tving|gtwavve|gtwalve/, ['tving', 'wavve']],
    [/웨이브|wavve/, ['wavve']],
    [/왓챠|watcha/, ['watcha']],
    [/라프텔|laftel/, ['laftel']],
    [/쿠팡|coupang/, ['coupang']],
    [/유튜브|youtube|google/, ['youtube', 'google']],
    [/애플|apple/, ['apple']],
    [/프라임|prime|amazon/, ['prime', 'amazon']],
  ];
  for (const [re, keys] of pairs) if (re.test(normalized)) return keys;
  return normalized ? [normalized] : [];
}

export function loadAliasPinStore(): Record<string, PinRecord> {
  const path = pinStorePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, PinRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function makeEmailVerifyMemo(emailId: string | number, pin: string): string {
  return `✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!! ✅
로그인 시도 간 필요한 이메일 코드는 아래 사이트에서 언제든지 셀프인증 가능합니다!
https://email-verify.xyz/email/mail/${emailId}
사이트에서 필요한 핀번호는 : ${pin}입니다!

프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!
만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다! 예)홍길동 또는 홍*동
만약, 접속 시 기본 프로필 1개만 있거나 자리가 꽉 찼는데 기본 프로필이 있다면 그걸 먼저 수정하고 사용하시면 되겠습니다!

즐거운 시청되세요!`;
}

function chooseAlias(accountEmail: string, serviceType: string, aliases: EmailAliasCandidate[], pinStore: Record<string, PinRecord>) {
  const targetEmail = normalizeEmail(accountEmail);
  const enabledAliases = aliases.filter(a => a && a.id !== undefined && a.email && a.enabled !== false);
  const direct = enabledAliases.find(a => normalizeEmail(a.email) === targetEmail);
  if (direct) return direct;

  const keys = serviceKeywords(serviceType);
  const withPin = enabledAliases.filter(a => pinStore[String(a.id)]?.pin);
  const serviceMatches = withPin.filter(a => keys.some(key => normalizeEmail(a.email).includes(key)));
  if (serviceMatches.length) {
    return serviceMatches.sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  const emailLocalPrefix = targetEmail.split('@')[0]?.replace(/\d+.*$/, '') || '';
  if (emailLocalPrefix) {
    const prefixMatches = withPin.filter(a => normalizeEmail(a.email).startsWith(emailLocalPrefix));
    if (prefixMatches.length) return prefixMatches.sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  return null;
}

export async function resolveEmailAliasFill(input: {
  accountEmail: string;
  serviceType: string;
  aliases: EmailAliasCandidate[];
}): Promise<EmailAliasFillResult> {
  const accountEmail = input.accountEmail.trim();
  const serviceType = input.serviceType.trim();
  const pinStore = loadAliasPinStore();
  const alias = chooseAlias(accountEmail, serviceType, input.aliases, pinStore);
  const pin = alias ? pinStore[String(alias.id)]?.pin?.trim() || null : null;
  const missing: Array<'email' | 'pin'> = [];
  if (!alias) missing.push('email');
  if (!pin) missing.push('pin');

  const ok = Boolean(alias && pin);
  return {
    ok,
    found: ok,
    email: alias?.email || accountEmail,
    serviceType,
    emailId: alias?.id ?? null,
    pin,
    memo: ok ? makeEmailVerifyMemo(alias!.id, pin!) : '',
    missing,
    ...(ok ? {} : { message: missing.includes('email') ? '이 계정과 연결된 이메일 대시보드 alias를 찾지 못했어요.' : '이 계정 alias의 PIN 번호가 설정되어 있지 않아요.' }),
  };
}
