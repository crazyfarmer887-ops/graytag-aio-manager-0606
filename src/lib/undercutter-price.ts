export interface UndercutterPricePlanInput {
  currentPrice: number;
  targetDaily: number;
  remainderDays: number;
  maxDecreaseOnce: number;
  minPrice: number;
}

export interface UndercutterPricePlan {
  targetPrice: number;
  nextPrice: number;
  delta: number;
  stepped: boolean;
  reason: string;
}

export function planUndercutterPriceChange(input: UndercutterPricePlanInput): UndercutterPricePlan {
  const currentPrice = Math.max(0, Math.floor(Number(input.currentPrice) || 0));
  const targetDaily = Math.max(0, Math.floor(Number(input.targetDaily) || 0));
  const remainderDays = Math.max(0, Math.floor(Number(input.remainderDays) || 0));
  const minPrice = Math.max(0, Math.floor(Number(input.minPrice) || 0));

  const targetPrice = Math.max(minPrice, targetDaily * remainderDays);
  const delta = targetPrice - currentPrice;

  return {
    targetPrice,
    nextPrice: targetPrice,
    delta,
    stepped: false,
    reason: delta === 0 ? '이미 목표 가격' : '목표 가격 한 번에 적용',
  };
}
