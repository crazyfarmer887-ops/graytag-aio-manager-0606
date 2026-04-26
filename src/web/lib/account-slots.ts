export interface SlotCountsInput {
  totalSlots: number;
  usingCount: number;
  verifyingCount?: number;
  manualCount?: number;
  activeCount?: number;
  recruitingCount?: number;
}

export type SlotState = 'using' | 'verifying' | 'manual' | 'recruiting' | 'active' | 'empty';

export function dedupeRecruitingProducts<T extends { productUsid?: string | null }>(products: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const product of products || []) {
    const id = String(product?.productUsid || '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(product);
  }
  return out;
}

export function buildAccountSlotStates(input: SlotCountsInput): SlotState[] {
  const total = Math.max(0, input.totalSlots || 0);
  const verifyingCount = Math.max(0, input.verifyingCount || 0);
  const pureUsingCount = Math.max(0, (input.usingCount || 0) - verifyingCount);
  const manualCount = Math.max(0, input.manualCount || 0);
  const recruitingCount = Math.max(0, input.recruitingCount || 0);
  const activeCount = Math.max(0, input.activeCount || 0);
  const states: SlotState[] = [];

  for (let i = 0; i < total; i++) {
    if (i < pureUsingCount) states.push('using');
    else if (i < pureUsingCount + verifyingCount) states.push('verifying');
    else if (i < pureUsingCount + verifyingCount + manualCount) states.push('manual');
    else if (i < pureUsingCount + verifyingCount + manualCount + recruitingCount) states.push('recruiting');
    else if (i < activeCount) states.push('active');
    else states.push('empty');
  }
  return states;
}

export function mergeRecruitingProducts<T extends { productUsid?: string | null }>(existing: T[], additions: T[]): T[] {
  return dedupeRecruitingProducts([...(existing || []), ...(additions || [])]);
}
