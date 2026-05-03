import { buildPartyAccessDeliveryTemplate, PARTY_ACCESS_URL_PLACEHOLDER } from './party-access-template';

export const DEFAULT_SELLING_GUIDE_SUFFIX = '구매 시 제공되는 "직접 운영하는" 이메일 코드 확인 사이트를 통해 언제든지 이메일을 확인하실 수 있으십니다!\n\n❤️ 1 1 1 원칙을 꼭 지켜주세요 ❤️\n1인 1기기 1계정 원칙이며 어길 시 약정에 의거 위약금 부과됩니다!';

export function makeDefaultSellingGuide(serviceLabel: string): string {
  return `✅ 이메일 코드 언제든지 셀프인증 가능! ✅ ${serviceLabel} 프리미엄!\n${DEFAULT_SELLING_GUIDE_SUFFIX}`;
}

export interface FillProductModelInput {
  category: string;
  endDate: string;
  price: number;
  productName: string;
  serviceType: string;
  sellingGuide?: string;
}

export function buildFillProductModel(input: FillProductModelInput): Record<string, string> {
  const productModel: Record<string, string> = {
    tempProductCategory: input.category,
    endDate: input.endDate,
    priceType: 'Normal',
    price: String(input.price),
    name: input.productName,
    sellingGuide: input.sellingGuide?.trim() || makeDefaultSellingGuide(input.serviceType),
  };
  if (input.category === 'Netflix') {
    productModel.netflixSeatCount = '5';
    productModel.productCountryString = 'Domestic';
  }
  return productModel;
}

export function buildAutoFillDeliveryMemo(_profileNickname: string, accessUrl = PARTY_ACCESS_URL_PLACEHOLDER): string {
  return buildPartyAccessDeliveryTemplate(accessUrl || PARTY_ACCESS_URL_PLACEHOLDER);
}

export function buildFillPartyAccessMember(input: { productUsid: string | number; profileNickname: string; endDateTime: string }) {
  return {
    kind: 'graytag' as const,
    memberId: `fill:${String(input.productUsid || '').trim()}`,
    memberName: '구매자',
    profileName: String(input.profileNickname || '').trim() || '구매자',
    status: 'OnSale',
    statusName: '판매 중',
    startDateTime: null,
    endDateTime: String(input.endDateTime || '').trim() || null,
  };
}

export function assertAutoDeliveryInput(input: { keepAcct?: string; keepPasswd?: string; keepMemo?: string }): string | null {
  if (!input.keepAcct?.trim()) return '계정 아이디가 없어 자동전달 설정을 할 수 없어요.';
  if (!input.keepPasswd?.trim()) return '계정 비밀번호가 없어 자동전달 설정을 할 수 없어요.';
  if (!input.keepMemo?.trim()) return '계정 전달 문구가 없어 자동전달 설정을 할 수 없어요.';
  return null;
}

export interface PasswordCandidate {
  keepAcct?: string;
  productType?: string;
  serviceType?: string;
  keepPasswd?: string;
}

function sameNormalizedText(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a?.trim()) && Boolean(b?.trim()) && a!.trim().toLowerCase() === b!.trim().toLowerCase();
}

export function findExactPasswordForAccount(
  accountEmail: string,
  serviceType: string,
  onSaleList: PasswordCandidate[] = [],
  onSaleByKeepAcct: Record<string, PasswordCandidate[]> = {},
): string {
  const candidates = [
    ...onSaleList,
    ...(onSaleByKeepAcct[accountEmail] || []),
  ];
  const found = candidates.find((item) =>
    sameNormalizedText(item.keepAcct, accountEmail)
    && (sameNormalizedText(item.productType, serviceType) || sameNormalizedText(item.serviceType, serviceType))
    && Boolean(item.keepPasswd?.trim())
  );
  return found?.keepPasswd?.trim() || '';
}

export function requireExactAliasMemoForAutoFill(input: { statusOk?: boolean; memo?: string; expectedMemo?: string }): string | null {
  if (!input.statusOk) return '이메일/PIN 정보를 정확히 찾은 계정만 자동 등록할 수 있어요.';
  if (!input.memo?.trim()) return '계정 전달 문구가 없어 자동전달 설정을 할 수 없어요.';
  if (input.expectedMemo !== undefined && input.memo.trim() !== input.expectedMemo.trim()) return '계정 전달 문구가 Email Dashboard에서 확인된 내용과 다르게 변경되어 자동 등록할 수 없어요.';
  return null;
}

export function buildFinishedDealsUrl(kind: 'after' | 'before', page: number, rows = 500, finishedDealIncluded = true): string {
  const endpoint = kind === 'after' ? 'findAfterUsingLenderDeals' : 'findBeforeUsingLenderDeals';
  return `https://graytag.co.kr/ws/lender/${endpoint}?finishedDealIncluded=${finishedDealIncluded ? 'true' : 'false'}&sorting=Latest&page=${page}&rows=${rows}`;
}
