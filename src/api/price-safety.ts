import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PriceSafetyConfig {
  enabled: boolean;
  minPrice: number;
  maxDecreaseOnce: number;
  maxDailyDecreaseCount: number;
  excludedProductIds: string[];
}

export interface PriceChangeInput {
  productId?: string | number | null;
  title?: string | null;
  currentPrice: number | string;
  nextPrice: number | string;
}

export interface PriceSafetyPreview {
  allowed: boolean;
  delta: number;
  warnings: string[];
  blockedReasons: string[];
}

type DecreaseEvents = Record<string, Record<string, number>>;

export const DEFAULT_PRICE_SAFETY_CONFIG: PriceSafetyConfig = {
  enabled: true,
  minPrice: 1000,
  maxDecreaseOnce: 1000,
  maxDailyDecreaseCount: 3,
  excludedProductIds: [],
};

function dataPath(filename: string, envKey: string): string {
  return process.env[envKey] || resolve(process.cwd(), 'data', filename);
}

export function priceSafetyConfigPath(): string {
  return dataPath('price-safety.json', 'PRICE_SAFETY_PATH');
}

function priceSafetyEventsPath(): string {
  return dataPath('price-safety-events.json', 'PRICE_SAFETY_EVENTS_PATH');
}

function ensureParent(filePath: string): void {
  const dir = filePath.replace(/\/[^/]+$/, '');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function loadPriceSafetyConfig(): PriceSafetyConfig {
  try {
    const filePath = priceSafetyConfigPath();
    if (!existsSync(filePath)) return { ...DEFAULT_PRICE_SAFETY_CONFIG };
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PriceSafetyConfig>;
    return sanitizePriceSafetyConfig(raw);
  } catch {
    return { ...DEFAULT_PRICE_SAFETY_CONFIG };
  }
}

export function sanitizePriceSafetyConfig(input: Partial<PriceSafetyConfig>): PriceSafetyConfig {
  const minPrice = finiteNumber(input.minPrice);
  const maxDecreaseOnce = finiteNumber(input.maxDecreaseOnce);
  const maxDailyDecreaseCount = finiteNumber(input.maxDailyDecreaseCount);
  return {
    enabled: input.enabled !== false,
    minPrice: minPrice !== null && minPrice >= 0 ? Math.floor(minPrice) : DEFAULT_PRICE_SAFETY_CONFIG.minPrice,
    maxDecreaseOnce: maxDecreaseOnce !== null && maxDecreaseOnce >= 0 ? Math.floor(maxDecreaseOnce) : DEFAULT_PRICE_SAFETY_CONFIG.maxDecreaseOnce,
    maxDailyDecreaseCount: maxDailyDecreaseCount !== null && maxDailyDecreaseCount >= 0 ? Math.floor(maxDailyDecreaseCount) : DEFAULT_PRICE_SAFETY_CONFIG.maxDailyDecreaseCount,
    excludedProductIds: Array.isArray(input.excludedProductIds)
      ? input.excludedProductIds.map(String).map((s) => s.trim()).filter(Boolean)
      : [],
  };
}

export function savePriceSafetyConfig(input: Partial<PriceSafetyConfig>): PriceSafetyConfig {
  const config = sanitizePriceSafetyConfig(input);
  const filePath = priceSafetyConfigPath();
  ensureParent(filePath);
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function loadDecreaseEvents(): DecreaseEvents {
  try {
    const filePath = priceSafetyEventsPath();
    if (!existsSync(filePath)) return {};
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' ? raw as DecreaseEvents : {};
  } catch {
    return {};
  }
}

function saveDecreaseEvents(events: DecreaseEvents): void {
  const filePath = priceSafetyEventsPath();
  ensureParent(filePath);
  writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf8');
}

export function previewPriceChange(input: PriceChangeInput, config = loadPriceSafetyConfig()): PriceSafetyPreview {
  const currentPrice = finiteNumber(input.currentPrice);
  const nextPrice = finiteNumber(input.nextPrice);
  const warnings: string[] = [];
  const blockedReasons: string[] = [];

  if (currentPrice === null || currentPrice < 0) blockedReasons.push('currentPrice가 올바르지 않습니다');
  if (nextPrice === null || nextPrice < 0) blockedReasons.push('nextPrice가 올바르지 않습니다');

  const delta = currentPrice !== null && nextPrice !== null ? Math.floor(nextPrice - currentPrice) : 0;

  if (!config.enabled) {
    warnings.push('가격 안전장치가 비활성화되어 있습니다');
    return { allowed: blockedReasons.length === 0, delta, warnings, blockedReasons };
  }

  const productId = input.productId == null ? '' : String(input.productId).trim();
  if (productId && config.excludedProductIds.includes(productId)) {
    blockedReasons.push('가격 변경 제외 상품입니다');
  }

  if (nextPrice !== null && nextPrice < config.minPrice) {
    blockedReasons.push(`최소 가격 ${config.minPrice}원 미만입니다`);
  }

  if (delta < 0) {
    const decrease = Math.abs(delta);
    if (decrease > config.maxDecreaseOnce) {
      blockedReasons.push(`1회 최대 인하폭 ${config.maxDecreaseOnce}원을 초과했습니다`);
    }
    if (productId && config.maxDailyDecreaseCount >= 0) {
      const events = loadDecreaseEvents();
      const count = events[todayKey()]?.[productId] || 0;
      if (count >= config.maxDailyDecreaseCount) {
        blockedReasons.push(`일일 가격 인하 횟수 ${config.maxDailyDecreaseCount}회를 초과했습니다`);
      }
    }
  } else if (delta > 0) {
    warnings.push(`가격이 ${delta}원 인상됩니다`);
  } else {
    warnings.push('가격 변동이 없습니다');
  }

  return { allowed: blockedReasons.length === 0, delta, warnings, blockedReasons };
}

export function assertPriceChangeAllowed(input: PriceChangeInput, config = loadPriceSafetyConfig()): PriceSafetyPreview {
  return previewPriceChange(input, config);
}

export function recordSuccessfulPriceDecrease(input: PriceChangeInput, config = loadPriceSafetyConfig()): void {
  if (!config.enabled) return;
  const preview = previewPriceChange(input, config);
  if (!preview.allowed || preview.delta >= 0) return;
  const productId = input.productId == null ? '' : String(input.productId).trim();
  if (!productId) return;
  const events = loadDecreaseEvents();
  const day = todayKey();
  events[day] = events[day] || {};
  events[day][productId] = (events[day][productId] || 0) + 1;
  saveDecreaseEvents(events);
}
