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
  const maxDecreaseOnce = Math.max(0, Math.floor(Number(input.maxDecreaseOnce) || 0));
  const minPrice = Math.max(0, Math.floor(Number(input.minPrice) || 0));

  const targetPrice = Math.max(minPrice, targetDaily * remainderDays);
  const targetDelta = targetPrice - currentPrice;

  if (targetDelta < 0 && maxDecreaseOnce > 0 && Math.abs(targetDelta) > maxDecreaseOnce) {
    const nextPrice = Math.max(minPrice, currentPrice - maxDecreaseOnce);
    return {
      targetPrice,
      nextPrice,
      delta: nextPrice - currentPrice,
      stepped: true,
      reason: `1회 최대 인하폭에 맞춰 단계 인하 (${currentPrice}원 → ${nextPrice}원, 최종 목표 ${targetPrice}원)`,
    };
  }

  return {
    targetPrice,
    nextPrice: targetPrice,
    delta: targetDelta,
    stepped: false,
    reason: targetDelta === 0 ? '이미 목표 가격' : '목표 가격 직접 적용',
  };
}
