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

export function assertAutoDeliveryInput(input: { keepAcct?: string; keepPasswd?: string; keepMemo?: string }): string | null {
  if (!input.keepAcct?.trim()) return '계정 아이디가 없어 자동전달 설정을 할 수 없어요.';
  if (!input.keepPasswd?.trim()) return '계정 비밀번호가 없어 자동전달 설정을 할 수 없어요.';
  if (!input.keepMemo?.trim()) return '계정 전달 문구가 없어 자동전달 설정을 할 수 없어요.';
  return null;
}

export function buildFinishedDealsUrl(kind: 'after' | 'before', page: number, rows = 500, finishedDealIncluded = true): string {
  const endpoint = kind === 'after' ? 'findAfterUsingLenderDeals' : 'findBeforeUsingLenderDeals';
  return `https://graytag.co.kr/ws/lender/${endpoint}?finishedDealIncluded=${finishedDealIncluded ? 'true' : 'false'}&sorting=Latest&page=${page}&rows=${rows}`;
}
