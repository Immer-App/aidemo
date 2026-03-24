import type { ImageAsset, ToolDefinition, ToolOutput } from "./types";

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
  }) => Promise<string>;
};

const SYSTEM_PROMPT = `Je bent BegrAIp, een didactische AI-assistent voor begrijpend lezen.
Je schrijft in helder Nederlands.
Je volgt de gevraagde instellingen exact.
Je antwoordt uitsluitend met geldige JSON zonder markdown of extra toelichting.`;

const cleanJson = (text: string): string =>
  text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

const parseToolOutput = (raw: string): ToolOutput => JSON.parse(cleanJson(raw)) as ToolOutput;

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

const readAnthropicText = (payload: unknown): string | undefined => {
  const data = payload as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
};

const readGoogleText = (payload: unknown): string | undefined => {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("\n");
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

const ANTHROPIC_MESSAGES_ENDPOINT = import.meta.env.DEV
  ? "/api/anthropic/v1/messages"
  : "https://api.anthropic.com/v1/messages";

const runOpenAICompatible = async (input: {
  apiKey: string;
  model: string;
  endpoint: string;
  providerLabel: string;
  instruction: string;
  extraHeaders?: Record<string, string>;
}) => {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      ...input.extraHeaders
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input.instruction }
      ]
    })
  });

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
  return text;
};

const runAnthropic = async (input: {
  apiKey: string;
  model: string;
  instruction: string;
}) => {
  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
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
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Anthropic gaf een fout (${response.status}).`));
  }

  const payload = (await response.json()) as unknown;
  const text = readAnthropicText(payload);
  if (!text) {
    throw new Error("Geen inhoud ontvangen van Anthropic.");
  }
  return text;
};

const runGoogle = async (input: {
  apiKey: string;
  model: string;
  instruction: string;
}) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const response = await fetch(endpoint, {
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
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Google AI gaf een fout (${response.status}).`));
  }

  const payload = (await response.json()) as unknown;
  const text = readGoogleText(payload);
  if (!text) {
    throw new Error("Geen inhoud ontvangen van Google AI.");
  }
  return text;
};

const generateOpenAIImage = async (apiKey: string, prompt: string, size: string) => {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size
    })
  });

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
    supportsImages: false,
    runText: runGoogle
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
  text: string;
  tool: ToolDefinition;
  values: Record<string, string | number | boolean>;
}): Promise<ToolOutput> => {
  const provider = PROVIDER_BY_ID[input.providerId];
  ensureApiKey(input.apiKey, provider.label);

  const instruction = input.tool.buildInstruction({
    text: input.text,
    values: input.values
  });

  const rawText = await provider.runText({
    apiKey: input.apiKey,
    model: input.model,
    instruction
  });

  const parsed = parseToolOutput(rawText);

  if (input.tool.outputKind !== "images" || !parsed.images?.length) {
    return parsed;
  }

  if (!provider.supportsImages) {
    return {
      ...parsed,
      images: parsed.images.map((asset: ImageAsset) => ({
        ...asset,
        imageError: `${provider.label} is in BegrAIp nu alleen gekoppeld voor tekstoutput. De prompts zijn wel al gegenereerd.`
      }))
    };
  }

  const size = String(input.values.aspect ?? "1536x1024");
  const imageResults: ImageAsset[] = await Promise.all(
    parsed.images.map(async (asset) => {
      try {
        const imageUrl = await generateOpenAIImage(input.apiKey, asset.prompt, size);
        return { ...asset, imageUrl };
      } catch (error) {
        return {
          ...asset,
          imageError: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  return {
    ...parsed,
    images: imageResults
  };
};
