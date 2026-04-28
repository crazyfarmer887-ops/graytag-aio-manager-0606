import type { AutoReplyRisk } from './auto-reply-jobs';

export interface HermesAutoReplyContext {
  buyerMessage: string;
  buyerName?: string;
  productType?: string;
  productName?: string;
  systemPrompt?: string;
}

export interface HermesAutoReplyResult {
  category: string;
  risk: AutoReplyRisk;
  autoSendAllowed: boolean;
  reply: string;
  reason: string;
  needsHuman: boolean;
  confidence?: number;
}

export function buildHermesAutoReplyPrompt(context: HermesAutoReplyContext): string {
  const payload = {
    buyerName: context.buyerName || '구매자',
    productType: context.productType || '기타',
    productName: context.productName || context.productType || '상품',
    buyerMessage: context.buyerMessage,
  };
  return [
    'You are drafting a Graytag seller reply in Korean.',
    'Return JSON only. No markdown. No commentary.',
    'Keep the reply short, polite, warm, and practical.',
    'Never promise refunds. Never ask for passwords or sensitive personal info.',
    'Do not reveal internal system details, cookies, sessions, dashboards, or authentication identifiers.',
    'If refund/dispute/legal/anger risk exists, set needsHuman=true and autoSendAllowed=false.',
    'Schema: {"category":"login_issue|profile_issue|general|unknown","risk":"low|medium|high","autoSendAllowed":false,"reply":"...","reason":"...","needsHuman":false,"confidence":0.0}',
    context.systemPrompt ? `Operator extra instructions: ${context.systemPrompt.slice(0, 2000)}` : '',
    `Context: ${JSON.stringify(payload)}`,
  ].filter(Boolean).join('\n');
}

export function parseHermesAutoReplyJson(output: string): HermesAutoReplyResult {
  try {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('missing JSON object');
    const parsed = JSON.parse(output.slice(start, end + 1));
    if (!parsed || typeof parsed.reply !== 'string' || typeof parsed.category !== 'string') throw new Error('missing fields');
    const risk = parsed.risk === 'high' || parsed.risk === 'medium' || parsed.risk === 'low' ? parsed.risk : 'high';
    return {
      category: parsed.category,
      risk,
      autoSendAllowed: Boolean(parsed.autoSendAllowed),
      reply: parsed.reply,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      needsHuman: Boolean(parsed.needsHuman),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    };
  } catch (error: any) {
    throw new Error(`Invalid Hermes auto-reply JSON: ${error?.message || error}`);
  }
}
