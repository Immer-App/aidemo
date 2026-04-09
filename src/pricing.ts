import type { ProviderId } from "./openai";
import type { CostEstimate, TokenUsage } from "./types";

type ProviderModelPreset = {
  id: string;
  label: string;
};

type PricingRule = {
  providerId: ProviderId;
  match: (model: string) => boolean;
  estimate: (usage: TokenUsage) => CostEstimate | undefined;
};

const toCost = (tokens: number | undefined, usdPerMillion: number | undefined) =>
  typeof tokens === "number" && typeof usdPerMillion === "number"
    ? (tokens / 1_000_000) * usdPerMillion
    : undefined;

const makeFlatRule = (
  providerId: ProviderId,
  matcher: RegExp,
  inputPerMillion: number,
  outputPerMillion: number,
  pricingLabel: string
): PricingRule => ({
  providerId,
  match: (model) => matcher.test(model),
  estimate: (usage) => {
    const inputCostUsd = toCost(usage.inputTokens, inputPerMillion);
    const outputCostUsd = toCost(usage.outputTokens, outputPerMillion);
    return {
      inputCostUsd,
      outputCostUsd,
      totalCostUsd:
        typeof inputCostUsd === "number" || typeof outputCostUsd === "number"
          ? (inputCostUsd ?? 0) + (outputCostUsd ?? 0)
          : undefined,
      pricingLabel
    };
  }
});

const pricingRules: PricingRule[] = [
  makeFlatRule("openai", /^gpt-5-mini$/i, 0.25, 2, "OpenAI GPT-5 mini"),
  makeFlatRule("openai", /^gpt-5$/i, 1.25, 10, "OpenAI GPT-5"),
  makeFlatRule("openai", /^gpt-4o-mini$/i, 0.15, 0.6, "OpenAI GPT-4o mini"),
  makeFlatRule("anthropic", /claude-sonnet-4-5|claude-sonnet-4-6|claude-sonnet-4/i, 3, 15, "Anthropic Sonnet tarief"),
  makeFlatRule("anthropic", /claude-opus-4-6/i, 5, 25, "Anthropic Opus 4.6 tarief"),
  makeFlatRule("anthropic", /claude-opus-4/i, 15, 75, "Anthropic Opus 4 tarief"),
  makeFlatRule("anthropic", /claude-haiku-4-5/i, 1, 5, "Anthropic Haiku 4.5 tarief"),
  makeFlatRule("anthropic", /claude-haiku/i, 0.8, 4, "Anthropic Haiku tarief"),
  makeFlatRule("google", /gemini-2\.5-flash-lite/i, 0.1, 0.4, "Gemini 2.5 Flash-Lite standard"),
  makeFlatRule("google", /gemini-2\.5-flash(?!-lite|-image|-native-audio|-preview-tts)/i, 0.3, 2.5, "Gemini 2.5 Flash standard"),
  {
    providerId: "google",
    match: (model) => /gemini-2\.5-pro/i.test(model),
    estimate: (usage) => {
      const longPrompt = (usage.inputTokens ?? 0) > 200_000;
      const inputRate = longPrompt ? 2.5 : 1.25;
      const outputRate = longPrompt ? 15 : 10;
      const inputCostUsd = toCost(usage.inputTokens, inputRate);
      const outputCostUsd = toCost(usage.outputTokens, outputRate);
      return {
        inputCostUsd,
        outputCostUsd,
        totalCostUsd:
          typeof inputCostUsd === "number" || typeof outputCostUsd === "number"
            ? (inputCostUsd ?? 0) + (outputCostUsd ?? 0)
            : undefined,
        pricingLabel: `Gemini 2.5 Pro standard, ${longPrompt ? "> 200k" : "<= 200k"} input tokens`
      };
    }
  }
];

export const PROVIDER_MODEL_PRESETS: Record<ProviderId, ProviderModelPreset[]> = {
  openai: [
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" }
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
  ],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" }
  ],
  mistral: [
    { id: "mistral-small-latest", label: "Mistral Small" },
    { id: "mistral-medium-latest", label: "Mistral Medium" }
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" }
  ]
};

export const estimateCost = (
  providerId: ProviderId,
  model: string,
  usage?: TokenUsage
): CostEstimate | undefined => {
  if (!usage) {
    return undefined;
  }
  const rule = pricingRules.find((entry) => entry.providerId === providerId && entry.match(model));
  return rule?.estimate(usage);
};
