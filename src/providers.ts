import type { ImageAsset, QuizQuestion, TokenUsage, ToolDefinition, ToolOutput } from "./types";

export type ProviderId = "openai" | "anthropic" | "google" | "mistral" | "groq";

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  defaultModel: string;
  envKey?: string;
  keyPlaceholder: string;
  supportsImages: boolean;
  runText: (input: {
    apiKey: string;
    model: string;
    instruction: string;
  }) => Promise<{ text: string; usage?: TokenUsage }>;
  generateImage?: (input: {
    apiKey: string;
    model: string;
    prompt: string;
    aspect: string;
  }) => Promise<{ imageUrl: string; model: string }>;
};

type ToolRunResult = {
  output: ToolOutput;
  usage?: TokenUsage;
  imageGenerationCount?: number;
  imageGenerationSize?: string;
  imageGenerationModel?: string;
};

const SYSTEM_PROMPT = `Je bent BegrAIp, een didactische AI-assistent voor begrijpend lezen.
Je schrijft in helder Nederlands.
Je volgt de gevraagde instellingen exact.
Je antwoordt uitsluitend met geldige JSON zonder markdown of extra toelichting.`;

const cleanJson = (text: string): string => {
  const stripped = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return stripped.slice(firstBrace, lastBrace + 1);
  }
  return stripped;
};

const parseToolOutput = (raw: string): ToolOutput => JSON.parse(cleanJson(raw)) as ToolOutput;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const normalizeTextBlock = (value: string) =>
  value
    .replace(/\r/g, "")
    .replace(/```+/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

const isValidQuizQuestion = (value: unknown): value is QuizQuestion =>
  isRecord(value) &&
  typeof value.prompt === "string" &&
  Array.isArray(value.choices) &&
  value.choices.every((choice) => typeof choice === "string") &&
  typeof value.correctIndex === "number";

const normalizeQuizExplanationList = (value: unknown, choiceCount: number) => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value.map((entry) =>
    typeof entry === "string" ? normalizeTextBlock(entry) : ""
  );
  return normalized.length === choiceCount ? normalized : undefined;
};

const normalizeToolOutput = (output: ToolOutput, tool: ToolDefinition): ToolOutput => {
  const normalized: ToolOutput = {
    title: typeof output.title === "string" ? normalizeTextBlock(output.title) : tool.name,
    summary: typeof output.summary === "string" ? normalizeTextBlock(output.summary) : "",
    sections: Array.isArray(output.sections)
      ? output.sections.filter(
          (section): section is { label: string; body: string } =>
            isRecord(section) &&
            typeof section.label === "string" &&
            typeof section.body === "string"
        ).map((section) => ({
          label: normalizeTextBlock(section.label),
          body: normalizeTextBlock(section.body)
        }))
      : undefined,
    bullets: Array.isArray(output.bullets)
      ? output.bullets
          .filter((bullet): bullet is string => typeof bullet === "string")
          .map((bullet) => normalizeTextBlock(bullet).replace(/^[-*]\s+/, ""))
      : undefined,
    highlights: Array.isArray(output.highlights)
      ? output.highlights.filter(
          (highlight): highlight is { label: string; color: string; tokenIds: number[] } =>
            isRecord(highlight) &&
            typeof highlight.label === "string" &&
            typeof highlight.color === "string" &&
            Array.isArray(highlight.tokenIds) &&
            highlight.tokenIds.every((tokenId) => typeof tokenId === "number")
        )
      : undefined,
    glossary: Array.isArray(output.glossary)
      ? output.glossary.filter(
          (item): item is NonNullable<ToolOutput["glossary"]>[number] =>
            isRecord(item) &&
            typeof item.term === "string" &&
            typeof item.definition === "string"
        ).map((item) => ({
          ...item,
          term: normalizeTextBlock(item.term),
          definition: normalizeTextBlock(item.definition),
          category: typeof item.category === "string" ? normalizeTextBlock(item.category) : undefined,
          example: typeof item.example === "string" ? normalizeTextBlock(item.example) : undefined
        }))
      : undefined,
    images: Array.isArray(output.images)
      ? output.images.filter(
          (image): image is NonNullable<ToolOutput["images"]>[number] =>
            isRecord(image) &&
            typeof image.title === "string" &&
            typeof image.prompt === "string" &&
            typeof image.alt === "string"
        ).map((image) => ({
          ...image,
          title: normalizeTextBlock(image.title),
          prompt: normalizeTextBlock(image.prompt),
          alt: normalizeTextBlock(image.alt)
        }))
      : undefined,
    timeline: Array.isArray(output.timeline)
      ? output.timeline.filter(
          (item): item is NonNullable<ToolOutput["timeline"]>[number] =>
            isRecord(item) && typeof item.title === "string"
        ).map((item) => ({
          title: normalizeTextBlock(item.title),
          detail: typeof item.detail === "string" ? normalizeTextBlock(item.detail) : undefined,
          cause: typeof item.cause === "string" ? normalizeTextBlock(item.cause) : undefined,
          effect: typeof item.effect === "string" ? normalizeTextBlock(item.effect) : undefined
        }))
      : undefined,
    references: Array.isArray(output.references)
      ? output.references.filter(
          (item): item is NonNullable<ToolOutput["references"]>[number] =>
            isRecord(item) &&
            Array.isArray(item.sourceTokenIds) &&
            item.sourceTokenIds.every((tokenId) => typeof tokenId === "number") &&
            Array.isArray(item.targetTokenIds) &&
            item.targetTokenIds.every((tokenId) => typeof tokenId === "number")
        ).map((item) => ({
          sourceTokenIds: item.sourceTokenIds,
          targetTokenIds: item.targetTokenIds,
          label: typeof item.label === "string" ? normalizeTextBlock(item.label) : undefined
        }))
      : undefined,
    quiz:
      isRecord(output.quiz) &&
      typeof output.quiz.title === "string" &&
      Array.isArray(output.quiz.questions)
        ? {
            title: normalizeTextBlock(output.quiz.title),
            instructions:
              typeof output.quiz.instructions === "string"
                ? normalizeTextBlock(output.quiz.instructions)
                : undefined,
            questions: output.quiz.questions.filter(isValidQuizQuestion).map((question) => ({
              ...question,
              prompt: normalizeTextBlock(question.prompt),
              choices: question.choices.map((choice) => normalizeTextBlock(choice)),
              explanation:
                typeof question.explanation === "string"
                  ? normalizeTextBlock(question.explanation)
                  : undefined,
              correctExplanation:
                typeof question.correctExplanation === "string"
                  ? normalizeTextBlock(question.correctExplanation)
                  : undefined,
              wrongExplanations: normalizeQuizExplanationList(
                isRecord(question) ? question.wrongExplanations : undefined,
                question.choices.length
              )
            }))
          }
        : undefined
  };

  if (tool.outputKind === "quiz" && (!normalized.quiz || normalized.quiz.questions.length === 0)) {
    throw new Error(
      `${tool.name} gaf ongeldige JSON terug: quizvragen of antwoordopties ontbreken.`
    );
  }

  return normalized;
};

const ensureApiKey = (apiKey: string, providerLabel: string) => {
  if (!apiKey.trim()) {
    throw new Error(`Vul eerst een API key in voor ${providerLabel}.`);
  }
};

const readOpenAIStyleText = (payload: unknown): string | undefined => {
  const data = payload as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content;
};

const readOpenAIStyleUsage = (payload: unknown): TokenUsage | undefined => {
  const data = payload as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  if (!data.usage) {
    return undefined;
  }
  return {
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    totalTokens: data.usage.total_tokens
  };
};

const readAnthropicText = (payload: unknown): string | undefined => {
  const data = payload as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
};

const readAnthropicUsage = (payload: unknown): TokenUsage | undefined => {
  const data = payload as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  if (!data.usage) {
    return undefined;
  }
  const inputTokens = data.usage.input_tokens;
  const outputTokens = data.usage.output_tokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      typeof inputTokens === "number" || typeof outputTokens === "number"
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined
  };
};

const readGoogleText = (payload: unknown): string | undefined => {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("\n");
};

const readGoogleUsage = (payload: unknown): TokenUsage | undefined => {
  const data = payload as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  if (!data.usageMetadata) {
    return undefined;
  }
  return {
    inputTokens: data.usageMetadata.promptTokenCount,
    outputTokens: data.usageMetadata.candidatesTokenCount,
    totalTokens: data.usageMetadata.totalTokenCount
  };
};

const readGoogleInlineImage = (payload: unknown): string | undefined => {
  const data = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mime_type?: string };
        }>;
      };
    }>;
  };

  const part = data.candidates?.[0]?.content?.parts?.find(
    (entry) => entry.inlineData?.data || entry.inline_data?.data
  );
  const encoded = part?.inlineData?.data ?? part?.inline_data?.data;
  const mimeType =
    part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? "image/png";

  return encoded ? `data:${mimeType};base64,${encoded}` : undefined;
};

const parseErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    return payload.error?.message ?? fallback;
  } catch {
    const text = await response.text();
    return text || fallback;
  }
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const parseRetryAfterMs = (response: Response) => {
  const rawValue = response.headers.get("retry-after");
  if (!rawValue) {
    return undefined;
  }
  const seconds = Number(rawValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const retryAt = Date.parse(rawValue);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }
  return undefined;
};

const fetchWithRateLimitRetry = async (
  input: RequestInfo | URL,
  init: RequestInit,
  providerLabel: string,
  maxRetries = 2
) => {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(input, init);
    if (response.status !== 429) {
      return response;
    }
    if (attempt === maxRetries) {
      throw new Error(
        await parseErrorMessage(
          response,
          `${providerLabel} gaf een 429 rate-limit fout. Er gaan dan te veel verzoeken tegelijk naar die API. Probeer het zo opnieuw of wacht even.`
        )
      );
    }
    await sleep(parseRetryAfterMs(response) ?? 1200 * (attempt + 1));
  }
  throw new Error(`${providerLabel} gaf een 429 rate-limit fout.`);
};

const ANTHROPIC_MESSAGES_ENDPOINT = import.meta.env.DEV
  ? "/api/anthropic/v1/messages"
  : "https://api.anthropic.com/v1/messages";

const supportsCustomTemperature = (providerLabel: string, model: string) => {
  if (providerLabel !== "OpenAI") {
    return true;
  }
  return !/^gpt-5($|[-.])/i.test(model);
};

const runOpenAICompatible = async (input: {
  apiKey: string;
  model: string;
  endpoint: string;
  providerLabel: string;
  instruction: string;
  extraHeaders?: Record<string, string>;
}) => {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: input.instruction }
    ]
  };

  if (supportsCustomTemperature(input.providerLabel, input.model)) {
    body.temperature = 0.7;
  }

  const response = await fetchWithRateLimitRetry(
    input.endpoint,
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      ...input.extraHeaders
    },
    body: JSON.stringify(body)
    },
    input.providerLabel
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(response, `${input.providerLabel} gaf een fout (${response.status}).`)
    );
  }

  const payload = (await response.json()) as unknown;
  const text = readOpenAIStyleText(payload);
  if (!text) {
    throw new Error(`Geen inhoud ontvangen van ${input.providerLabel}.`);
  }
  return {
    text,
    usage: readOpenAIStyleUsage(payload)
  };
};

const runAnthropic = async (input: {
  apiKey: string;
  model: string;
  instruction: string;
}) => {
  const response = await fetchWithRateLimitRetry(
    ANTHROPIC_MESSAGES_ENDPOINT,
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 4096,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: input.instruction }]
        }
      ]
    })
    },
    "Anthropic"
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Anthropic gaf een fout (${response.status}).`));
  }

  const payload = (await response.json()) as unknown;
  const text = readAnthropicText(payload);
  if (!text) {
    throw new Error("Geen inhoud ontvangen van Anthropic.");
  }
  return {
    text,
    usage: readAnthropicUsage(payload)
  };
};

const runGoogle = async (input: {
  apiKey: string;
  model: string;
  instruction: string;
}) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const response = await fetchWithRateLimitRetry(
    endpoint,
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.instruction }]
        }
      ],
      generationConfig: {
        temperature: 0.7
      }
    })
    },
    "Google AI"
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Google AI gaf een fout (${response.status}).`));
  }

  const payload = (await response.json()) as unknown;
  const text = readGoogleText(payload);
  if (!text) {
    throw new Error("Geen inhoud ontvangen van Google AI.");
  }
  return {
    text,
    usage: readGoogleUsage(payload)
  };
};

const GOOGLE_DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

const isGoogleImageModel = (model: string) => /image/i.test(model);

const GOOGLE_ASPECT_RATIO_BY_SIZE: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3"
};

const generateGoogleImage = async (input: {
  apiKey: string;
  model: string;
  prompt: string;
  aspect: string;
}) => {
  const model = isGoogleImageModel(input.model) ? input.model : GOOGLE_DEFAULT_IMAGE_MODEL;
  const aspectRatio = GOOGLE_ASPECT_RATIO_BY_SIZE[input.aspect] ?? "1:1";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const response = await fetchWithRateLimitRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio
          }
        }
      })
    },
    "Google AI image"
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Google AI image gaf een fout (${response.status}).`));
  }

  const payload = (await response.json()) as unknown;
  const imageUrl = readGoogleInlineImage(payload);
  if (!imageUrl) {
    throw new Error("Geen afbeelding ontvangen van Google AI.");
  }

  return { imageUrl, model };
};

const generateOpenAIImage = async (apiKey: string, prompt: string, size: string) => {
  const response = await fetchWithRateLimitRetry(
    "https://api.openai.com/v1/images/generations",
    {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size,
      quality: "medium"
    })
    },
    "OpenAI image"
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `OpenAI image gaf een fout (${response.status}).`));
  }

  const payload = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };
  const image = payload.data?.[0];

  if (image?.url) {
    return image.url;
  }
  if (image?.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }

  throw new Error("Geen afbeelding ontvangen.");
};

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    envKey: "VITE_OPENAI_API_KEY",
    keyPlaceholder: "sk-...",
    supportsImages: true,
    generateImage: async ({ apiKey, prompt, aspect }) => ({
      imageUrl: await generateOpenAIImage(apiKey, prompt, aspect),
      model: "gpt-image-1"
    }),
    runText: ({ apiKey, model, instruction }) =>
      runOpenAICompatible({
        apiKey,
        model,
        instruction,
        providerLabel: "OpenAI",
        endpoint: "https://api.openai.com/v1/chat/completions"
      })
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    envKey: "VITE_ANTHROPIC_API_KEY",
    keyPlaceholder: "sk-ant-...",
    supportsImages: false,
    runText: runAnthropic
  },
  {
    id: "google",
    label: "Google AI",
    defaultModel: "gemini-2.5-flash",
    envKey: "VITE_GOOGLE_API_KEY",
    keyPlaceholder: "AIza... / AQ...",
    supportsImages: true,
    runText: runGoogle,
    generateImage: generateGoogleImage
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral-small-latest",
    envKey: "VITE_MISTRAL_API_KEY",
    keyPlaceholder: "...",
    supportsImages: false,
    runText: ({ apiKey, model, instruction }) =>
      runOpenAICompatible({
        apiKey,
        model,
        instruction,
        providerLabel: "Mistral",
        endpoint: "https://api.mistral.ai/v1/chat/completions"
      })
  },
  {
    id: "groq",
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    envKey: "VITE_GROQ_API_KEY",
    keyPlaceholder: "gsk_...",
    supportsImages: false,
    runText: ({ apiKey, model, instruction }) =>
      runOpenAICompatible({
        apiKey,
        model,
        instruction,
        providerLabel: "Groq",
        endpoint: "https://api.groq.com/openai/v1/chat/completions"
      })
  }
];

export const PROVIDER_BY_ID = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider])
) as Record<ProviderId, ProviderConfig>;

export const DEFAULT_API_KEYS = Object.fromEntries(
  PROVIDERS.map((provider) => [provider.id, provider.envKey ? import.meta.env[provider.envKey] ?? "" : ""])
) as Record<ProviderId, string>;

export const runTool = async (input: {
  providerId: ProviderId;
  apiKey: string;
  model: string;
  tool: ToolDefinition;
  instruction: string;
  values: Record<string, string | number | boolean>;
}): Promise<ToolRunResult> => {
  const provider = PROVIDER_BY_ID[input.providerId];
  ensureApiKey(input.apiKey, provider.label);

  const providerResult = await provider.runText({
    apiKey: input.apiKey,
    model: input.model,
    instruction: input.instruction
  });

  const parsed = normalizeToolOutput(parseToolOutput(providerResult.text), input.tool);
  const filteredSections =
    input.tool.id === "text-structure" && input.values.includeTips === false
      ? parsed.sections?.filter((section) => section.label.toLowerCase() !== "leestips")
      : parsed.sections;
  const filteredBullets =
    input.tool.id === "summary" && input.values.format === "doorlopende tekst"
      ? undefined
      : parsed.bullets;
  const normalized: ToolOutput = {
    ...parsed,
    sections: filteredSections,
    bullets: filteredBullets
  };

  if (input.tool.outputKind !== "images" || !normalized.images?.length) {
    return {
      usage: providerResult.usage,
      output: normalized
    };
  }

  if (!provider.generateImage) {
    return {
      usage: providerResult.usage,
      output: {
        ...normalized,
        images: normalized.images.map((asset: ImageAsset) => ({
          ...asset,
          aspectRatio: String(input.values.aspect ?? "1536x1024"),
          imageError: `${provider.label} is in BegrAIp nu alleen gekoppeld voor tekstoutput. De prompts zijn wel al gegenereerd.`
        }))
      }
    };
  }

  const generateImage = provider.generateImage;
  if (!generateImage) {
    throw new Error(`${provider.label} ondersteunt geen beeldgeneratie in BegrAIp.`);
  }

  const size = String(input.values.aspect ?? "1536x1024");
  let imageGenerationModel: string | undefined;
  const imageResults: ImageAsset[] = await Promise.all(
    normalized.images.map(async (asset) => {
      try {
        const generated = await generateImage({
          apiKey: input.apiKey,
          model: input.model,
          prompt: asset.prompt,
          aspect: size
        });
        imageGenerationModel ??= generated.model;
        return { ...asset, aspectRatio: size, imageUrl: generated.imageUrl };
      } catch (error) {
        return {
          ...asset,
          aspectRatio: size,
          imageError: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  return {
    usage: providerResult.usage,
    imageGenerationCount: imageResults.filter((asset) => Boolean(asset.imageUrl)).length,
    imageGenerationSize: size,
    imageGenerationModel,
    output: {
      ...normalized,
      images: imageResults
    }
  };
};
