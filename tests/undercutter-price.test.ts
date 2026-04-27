import { describe, expect, test } from 'vitest';
import { planUndercutterPriceChange } from '../src/lib/undercutter-price';

describe('planUndercutterPriceChange', () => {
  test('steps down long 티빙 products instead of blocking a large one-shot drop', () => {
    const plan = planUndercutterPriceChange({
      currentPrice: 16206,
      targetDaily: 197,
      remainderDays: 72,
      maxDecreaseOnce: 1000,
      minPrice: 1000,
    });

    expect(plan.targetPrice).toBe(14184);
    expect(plan.nextPrice).toBe(15206);
    expect(plan.stepped).toBe(true);
    expect(plan.delta).toBe(-1000);
  });

  test('uses the target price directly when the drop is inside the safety window', () => {
    const plan = planUndercutterPriceChange({
      currentPrice: 4250,
      targetDaily: 197,
      remainderDays: 24,
      maxDecreaseOnce: 1000,
      minPrice: 1000,
    });

    expect(plan.targetPrice).toBe(4728);
    expect(plan.nextPrice).toBe(4728);
    expect(plan.stepped).toBe(false);
    expect(plan.delta).toBe(478);
  });
});
