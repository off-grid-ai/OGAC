// @offgrid/finops — pricing table + cost attribution.

import type { TrafficRecord } from './gateway-types.js';

export interface ModelPrice {
  inputPer1k: number;
  outputPer1k: number;
  currency: 'USD';
}

/**
 * Estimated blended cost per 1k tokens for a local / self-hosted model.
 * Off Grid runs models on the user's own hardware, so there is no API price —
 * this stands in for electricity + hardware amortization. Configurable.
 */
export const LOCAL_MODEL_COST = 0.00002;

const localPrice = (): ModelPrice => ({
  inputPer1k: LOCAL_MODEL_COST,
  outputPer1k: LOCAL_MODEL_COST,
  currency: 'USD',
});

/** Reference prices. Frontier prices are for attribution when a call is routed
 *  to a hosted model; local models resolve via priceFor() to LOCAL_MODEL_COST. */
export const PRICING: Record<string, ModelPrice> = {
  // Frontier reference prices (USD per 1k tokens).
  'claude-opus-4': { inputPer1k: 0.015, outputPer1k: 0.075, currency: 'USD' },
  'claude-sonnet-4': { inputPer1k: 0.003, outputPer1k: 0.015, currency: 'USD' },
  'claude-haiku-4': { inputPer1k: 0.0008, outputPer1k: 0.004, currency: 'USD' },
  'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015, currency: 'USD' },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006, currency: 'USD' },
  // Local / self-hosted models — estimated cost.
  gemma: localPrice(),
  qwen: localPrice(),
  qwythos: localPrice(),
  coder: localPrice(),
};

const LOCAL_SUBSTRINGS = ['gemma', 'qwen', 'qwythos', 'coder'];

/**
 * Resolve a price for a model id. Exact match wins; otherwise fuzzy substring
 * match (both directions). Known local model families and unknown models fall
 * back to the local estimate.
 */
export function priceFor(model: string, pricing: Record<string, ModelPrice> = PRICING): ModelPrice {
  if (pricing[model]) return pricing[model];
  const key = model.toLowerCase();
  for (const [id, price] of Object.entries(pricing)) {
    const idl = id.toLowerCase();
    if (key.includes(idl) || idl.includes(key)) return price;
  }
  for (const sub of LOCAL_SUBSTRINGS) {
    if (key.includes(sub)) return localPrice();
  }
  return localPrice();
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  total: number;
  currency: string;
}

/**
 * Cost of a single traffic record. Uses promptTokens/completionTokens when
 * present; otherwise splits `tokens` 50/50 between input and output.
 */
export function costOf(record: TrafficRecord, pricing: Record<string, ModelPrice> = PRICING): CostBreakdown {
  const price = priceFor(record.modelServed ?? record.model, pricing);
  let promptTokens = record.promptTokens;
  let completionTokens = record.completionTokens;
  if (promptTokens === undefined || completionTokens === undefined) {
    const half = record.tokens / 2;
    promptTokens = promptTokens ?? half;
    completionTokens = completionTokens ?? half;
  }
  const inputCost = (promptTokens / 1000) * price.inputPer1k;
  const outputCost = (completionTokens / 1000) * price.outputPer1k;
  return {
    inputCost,
    outputCost,
    total: inputCost + outputCost,
    currency: price.currency,
  };
}
