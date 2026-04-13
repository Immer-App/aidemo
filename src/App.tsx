import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent, trackProviderToggle, trackSelectionOnlyToggle } from "./analytics";
import { DEFAULT_API_KEYS, PROVIDER_BY_ID, PROVIDERS, runTool } from "./openai";
import { estimateCost, estimateOpenAIImageGenerationCost, PROVIDER_MODEL_PRESETS } from "./pricing";
import { TOOL_CATALOG, TOOL_BY_ID } from "./toolCatalog";
import type { ProviderId } from "./openai";
import type { QuizQuestion, RunGroup, RunResult, ToolDefinition, ToolField, UsageLogEntry } from "./types";

const API_KEY_STORAGE_KEY = "begraip-api-keys";
const MODEL_STORAGE_KEY = "begraip-models";
const ENABLED_PROVIDER_STORAGE_KEY = "begraip-enabled-providers";
const SELECTION_ONLY_STORAGE_KEY = "begraip-selection-only";
const DEMO_TEXT = `Op een winderige ochtend liep Amir met zijn oma over de dijk langs de rivier. 
De lucht was grijs, maar op het water dreven glinsterende strepen licht. 
Oma vertelde dat de rivier al eeuwenlang belangrijk was voor het dorp: vissers verdienden er hun brood, handelaren brachten goederen mee en kinderen leerden aan de oever zwemmen.

Bij het oude gemaal bleef Amir staan. Hij zag een verweerd bord met onbekende woorden als "stoomketel" en "waterpeil". 
"Waarom is dit gebouw zo belangrijk?" vroeg hij.

"Omdat mensen hier vroeger slim moesten samenwerken," zei oma. "Als het water te hoog kwam, overstroomden de straten. Dit gemaal hielp het dorp droog te houden."

Amir keek nog eens naar de rivier. Opeens begreep hij dat het water niet alleen mooi was, maar ook machtig. 
Wat vanzelfsprekend leek, bleek het resultaat van veel kennis, werk en keuzes van mensen uit het verleden.`;

type TopTab = "input" | "llms" | "runs";
type SourceToken = {
  key: string;
  text: string;
  wordId?: number;
};

const TOP_TABS: Array<{ id: TopTab; label: string }> = [
  { id: "input", label: "Input" },
  { id: "llms", label: "LLM's" },
  { id: "runs", label: "Resultaten" }
];

const formatSetting = (field: ToolField, value: string | number | boolean) => {
  if (field.type === "toggle") {
    return value ? "Aan" : "Uit";
  }
  const option = field.options?.find((item) => item.value === String(value));
  return option?.label ?? String(value);
};

const createRunId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatClockTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit"
  });

const formatDuration = (durationMs: number) => `${(durationMs / 1000).toFixed(1)} s`;
const formatTokens = (count?: number) => (typeof count === "number" ? count.toLocaleString("nl-NL") : "n.b.");
const formatUsd = (amount?: number) =>
  typeof amount === "number" ? `$${amount.toFixed(amount < 0.01 ? 4 : 2)}` : "n.b.";
const formatTokenBreakdown = (usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) =>
  `Input tokens ${formatTokens(usage?.inputTokens)} · Output tokens ${formatTokens(usage?.outputTokens)} · Totaal tokens ${formatTokens(usage?.totalTokens)}`;
const formatCostBreakdown = (cost?: {
  inputCostUsd?: number;
  outputCostUsd?: number;
  imageCostUsd?: number;
  totalCostUsd?: number;
}) => {
  const parts = [
    `Geschatte standaard API-kosten ${formatUsd(cost?.inputCostUsd)} in`,
    `${formatUsd(cost?.outputCostUsd)} uit`
  ];
  if (typeof cost?.imageCostUsd === "number") {
    parts.push(`${formatUsd(cost.imageCostUsd)} beeld`);
  }
  parts.push(`${formatUsd(cost?.totalCostUsd)} totaal`);
  return parts.join(" · ");
};
const costDisclaimer = "Free tier / promo niet meegerekend";
const customValueId = (fieldId: string) => `${fieldId}__custom`;
const toAnalyticsKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
const toAnalyticsString = (value: string | number | boolean) =>
  String(value).slice(0, 100);
const getSettingsAnalyticsParams = (settings: Record<string, string | number | boolean>) =>
  Object.fromEntries(
    Object.entries(settings)
      .filter(([key]) => !key.endsWith("__custom"))
      .slice(0, 8)
      .map(([key, value]) => [`setting_${toAnalyticsKey(key)}`, toAnalyticsString(value)])
  );

const resolveToolValues = (
  tool: ToolDefinition,
  rawValues: Record<string, string | number | boolean>
) => {
  const nextValues: Record<string, string | number | boolean> = { ...rawValues };
  for (const field of tool.fields) {
    if (field.type !== "select") {
      continue;
    }
    const customValue = String(rawValues[customValueId(field.id)] ?? "").trim();
    if (customValue) {
      nextValues[field.id] = customValue;
    }
  }
  return nextValues;
};

const getSelection = (text: string, start: number, end: number) => {
  if (start === end) {
    return "";
  }
  return text.slice(Math.min(start, end), Math.max(start, end)).trim();
};

const tokenizeText = (text: string) => {
  const tokens: SourceToken[] = [];
  let wordId = 1;
  for (const match of text.matchAll(/(\p{L}[\p{L}\p{N}'’.-]*|\s+|[^\s\p{L}\p{N}])/gu)) {
    const chunk = match[0];
    const isWord = /^\p{L}/u.test(chunk);
    tokens.push({
      key: `${tokens.length}-${chunk}`,
      text: chunk,
      wordId: isWord ? wordId++ : undefined
    });
  }
  const tokenMap = tokens
    .filter((token) => token.wordId !== undefined)
    .map((token) => `- ${token.wordId}: ${token.text}`)
    .join("\n");
  return { tokens, tokenMap, wordCount: wordId - 1 };
};

const getRunById = (groups: RunGroup[], runId: string | null) => {
  if (!runId) {
    return null;
  }
  for (const group of groups) {
    const match = group.runs.find((run) => run.id === runId);
    if (match) {
      return match;
    }
  }
  return null;
};

const getRunTone = (run: RunResult) => run.status;
const getSafeQuizQuestions = (questions: QuizQuestion[] | undefined) =>
  Array.isArray(questions)
    ? questions.filter(
        (question) =>
          question &&
          typeof question.prompt === "string" &&
          Array.isArray(question.choices) &&
          question.choices.every((choice) => typeof choice === "string") &&
          typeof question.correctIndex === "number"
      )
    : [];

const getQuizFeedback = (question: QuizQuestion) => ({
  wrongExplanations:
    Array.isArray(question.wrongExplanations) &&
    question.wrongExplanations.length === question.choices.length
      ? question.wrongExplanations
      : [],
  correctExplanation: question.correctExplanation ?? question.explanation
});

const splitStructuredLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const isNumberedLine = (line: string) => /^\d+[\).]\s+/.test(line);
const isBulletedLine = (line: string) => /^[-*•]\s+/.test(line);

const renderStructuredText = (body: string) => {
  const lines = splitStructuredLines(body);
  if (lines.length < 2) {
    return <p>{body}</p>;
  }

  if (lines.every(isNumberedLine)) {
    return (
      <ol className="formatted-list numbered-list">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{line.replace(/^\d+[\).]\s+/, "")}</li>
        ))}
      </ol>
    );
  }

  if (lines.every(isBulletedLine)) {
    return (
      <ul className="formatted-list bullet-list">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{line.replace(/^[-*•]\s+/, "")}</li>
        ))}
      </ul>
    );
  }

  return <p>{body}</p>;
};

const logUsageEvent = (entry: UsageLogEntry) => {
  const endpoint = import.meta.env.VITE_USAGE_LOG_ENDPOINT?.trim();
  if (!endpoint) {
    return;
  }
  const payload = JSON.stringify(entry);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(endpoint, blob);
      return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: payload,
    keepalive: true
  }).catch(() => {
    // Logging must never break the UI.
  });
};

export const App = () => {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeTab, setActiveTab] = useState<TopTab>("input");
  const [apiKeysByProvider, setApiKeysByProvider] = useState<Record<string, string>>(() => ({
    ...DEFAULT_API_KEYS
  }));
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      PROVIDERS.map((provider) => [
        provider.id,
        PROVIDER_MODEL_PRESETS[provider.id]?.[0]?.id ?? provider.defaultModel
      ])
    )
  );
  const [enabledProviderIds, setEnabledProviderIds] = useState<ProviderId[]>(["openai"]);
  const [text, setText] = useState(DEMO_TEXT);
  const [selectedRange, setSelectedRange] = useState({ start: 0, end: 0 });
  const [selectionOnly, setSelectionOnly] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState(TOOL_CATALOG[0].id);
  const [valuesByTool, setValuesByTool] = useState<Record<string, Record<string, string | number | boolean>>>(
    () => Object.fromEntries(TOOL_CATALOG.map((tool) => [tool.id, { ...tool.defaults }]))
  );
  const [customInstructionsByTool, setCustomInstructionsByTool] = useState<Record<string, string>>({});
  const [promptOverridesByTool, setPromptOverridesByTool] = useState<Record<string, string>>({});
  const [runGroups, setRunGroups] = useState<RunGroup[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [answersByResult, setAnswersByResult] = useState<Record<string, Record<number, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [activeReferenceSourceTokenId, setActiveReferenceSourceTokenId] = useState<number | null>(null);

  useEffect(() => {
    const savedKeys = window.localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedKeys) {
      setApiKeysByProvider((current) => ({
        ...current,
        ...(JSON.parse(savedKeys) as Record<string, string>)
      }));
    }

    const savedModels = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModels) {
      setModelsByProvider((current) => ({
        ...current,
        ...(JSON.parse(savedModels) as Record<string, string>)
      }));
    }

    const savedEnabledProviders = window.localStorage.getItem(ENABLED_PROVIDER_STORAGE_KEY);
    if (savedEnabledProviders) {
      const parsed = JSON.parse(savedEnabledProviders) as ProviderId[];
      const valid = parsed.filter((providerId) => providerId in PROVIDER_BY_ID);
      if (valid.length) {
        setEnabledProviderIds(valid);
      }
    }

    const savedSelectionOnly = window.localStorage.getItem(SELECTION_ONLY_STORAGE_KEY);
    if (savedSelectionOnly) {
      setSelectionOnly(savedSelectionOnly === "true");
    }

  }, []);

  useEffect(() => {
    window.localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(apiKeysByProvider));
  }, [apiKeysByProvider]);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(modelsByProvider));
  }, [modelsByProvider]);

  useEffect(() => {
    window.localStorage.setItem(ENABLED_PROVIDER_STORAGE_KEY, JSON.stringify(enabledProviderIds));
  }, [enabledProviderIds]);

  useEffect(() => {
    window.localStorage.setItem(SELECTION_ONLY_STORAGE_KEY, String(selectionOnly));
  }, [selectionOnly]);

  useEffect(() => {
    setSelectedRange((current) => ({
      start: Math.min(current.start, text.length),
      end: Math.min(current.end, text.length)
    }));
  }, [text]);

  const pendingRuns = runGroups.flatMap((group) => group.runs).filter((run) => run.status === "pending");

  useEffect(() => {
    if (!pendingRuns.length) {
      return;
    }
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(intervalId);
  }, [pendingRuns.length]);

  const selectedTool = TOOL_BY_ID[selectedToolId] as ToolDefinition;
  const rawSelectedValues = valuesByTool[selectedToolId];
  const selectedValues = useMemo(
    () => resolveToolValues(selectedTool, rawSelectedValues),
    [rawSelectedValues, selectedTool]
  );
  const customInstructions = customInstructionsByTool[selectedToolId] ?? "";
  const selectedText = getSelection(text, selectedRange.start, selectedRange.end);
  const { tokens: sourceTokens, tokenMap } = useMemo(() => tokenizeText(text), [text]);
  const generatedPrompt = selectedTool.buildInstruction({
    text,
    selectedText,
    values: selectedValues,
    customInstructions,
    tokenMap: selectedTool.id === "word-highlighter" ? tokenMap : undefined,
    selectionOnly
  });
  const promptOverride = promptOverridesByTool[selectedToolId];
  const activePrompt = promptOverride ?? generatedPrompt;
  const activeResult =
    getRunById(runGroups, activeResultId) ??
    runGroups.flatMap((group) => group.runs).find((run) => run.status === "success") ??
    null;
  const activeOutput = activeResult?.output;

  const highlightedWordMap = useMemo(() => {
    const entries = new Map<number, { color: string; label: string }>();
    activeOutput?.highlights?.forEach((group) => {
      group.tokenIds.forEach((tokenId) => {
        if (!entries.has(tokenId)) {
          entries.set(tokenId, { color: group.color, label: group.label });
        }
      });
    });
    return entries;
  }, [activeOutput]);

  const referenceSourceMap = useMemo(() => {
    const entries = new Map<number, { targetTokenIds: number[]; label?: string }>();
    activeOutput?.references?.forEach((reference) => {
      reference.sourceTokenIds.forEach((sourceTokenId) => {
        entries.set(sourceTokenId, {
          targetTokenIds: reference.targetTokenIds,
          label: reference.label
        });
      });
    });
    return entries;
  }, [activeOutput]);

  const activeReferenceTargetIds = useMemo(() => {
    if (activeReferenceSourceTokenId === null) {
      return new Set<number>();
    }
    return new Set(referenceSourceMap.get(activeReferenceSourceTokenId)?.targetTokenIds ?? []);
  }, [activeReferenceSourceTokenId, referenceSourceMap]);

  useEffect(() => {
    setActiveReferenceSourceTokenId(null);
  }, [activeResult?.id]);

  useEffect(() => {
    trackEvent("app_loaded", {
      initial_provider_count: enabledProviderIds.length
    });
  }, []);

  const providersWithoutImages =
    selectedTool.outputKind === "images"
      ? PROVIDERS.filter(
          (provider) => enabledProviderIds.includes(provider.id) && !provider.supportsImages
        )
      : [];

  const quizScore = (() => {
    if (!activeOutput?.quiz || !activeResult) {
      return null;
    }
    const safeQuestions = getSafeQuizQuestions(activeOutput.quiz.questions);
    if (!safeQuestions.length) {
      return null;
    }
    const answers = answersByResult[activeResult.id] ?? {};
    const correct = safeQuestions.reduce((score, question, index) => {
      return score + (answers[index] === question.correctIndex ? 1 : 0);
    }, 0);
    return {
      correct,
      total: safeQuestions.length,
      answered: Object.keys(answers).length
    };
  })();

  const updateValue = (field: ToolField, nextValue: string | number | boolean) => {
    setValuesByTool((current) => ({
      ...current,
      [selectedToolId]: {
        ...current[selectedToolId],
        [field.id]: nextValue
      }
    }));
  };

  const updateCustomValue = (fieldId: string, nextValue: string) => {
    setValuesByTool((current) => ({
      ...current,
      [selectedToolId]: {
        ...current[selectedToolId],
        [customValueId(fieldId)]: nextValue
      }
    }));
  };

  const toggleProvider = (providerId: ProviderId) => {
    setEnabledProviderIds((current) => {
      const enabled = !current.includes(providerId);
      trackProviderToggle(providerId, enabled);
      return enabled
        ? [...current, providerId]
        : current.filter((item) => item !== providerId);
    });
  };

  const updateSelectionFromTextArea = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    setSelectedRange({
      start: target.selectionStart,
      end: target.selectionEnd
    });
  };

  const clearSelection = () => {
    setSelectedRange({ start: 0, end: 0 });
    const textArea = textAreaRef.current;
    if (textArea) {
      textArea.focus();
      textArea.setSelectionRange(0, 0);
    }
  };

  const updateAnswer = (resultId: string, questionIndex: number, answerIndex: number) => {
    setAnswersByResult((current) => ({
      ...current,
      [resultId]: {
        ...(current[resultId] ?? {}),
        [questionIndex]: answerIndex
      }
    }));
  };

  const exportSessionResults = () => {
    const exportedAt = new Date().toISOString();
    const payload = {
      exportedAt,
      app: "BegrAIp",
      session: {
        runGroupCount: runGroups.length,
        resultCount: runGroups.reduce((count, group) => count + group.runs.length, 0)
      },
      runGroups
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `begraip-session-results-${exportedAt}.json`;
    link.click();
    URL.revokeObjectURL(url);

    trackEvent("session_results_exported", {
      run_group_count: payload.session.runGroupCount,
      result_count: payload.session.resultCount
    });
  };

  const runSelectedTool = async () => {
    if (!text.trim()) {
      setError("Plak eerst een tekst in de playground.");
      return;
    }

    if (!enabledProviderIds.length) {
      setError("Selecteer minstens een LLM-aanbieder om te vergelijken.");
      setActiveTab("llms");
      return;
    }

    const createdAt = Date.now();
    const groupId = createRunId();
    const pendingGroup: RunGroup = {
      id: groupId,
      toolId: selectedTool.id,
      toolName: selectedTool.name,
      createdAt,
      prompt: activePrompt,
      selectedText: selectedText || undefined,
      settings: selectedValues,
      autoSelectLocked: false,
      runs: enabledProviderIds.map((providerId) => {
        const provider = PROVIDER_BY_ID[providerId];
        return {
          id: createRunId(),
          groupId,
          toolId: selectedTool.id,
          toolName: selectedTool.name,
          createdAt,
          providerId,
          providerLabel: provider.label,
          model: modelsByProvider[providerId] ?? provider.defaultModel,
          status: "pending",
          prompt: activePrompt,
          selectedText: selectedText || undefined,
          settings: selectedValues
        } satisfies RunResult;
      })
    };

    setRunGroups((current) => [pendingGroup, ...current]);
    setActiveResultId(null);
    setActiveTab("runs");
    setError(null);

    trackEvent("tool_run_started", {
      tool_id: selectedTool.id,
      provider_count: enabledProviderIds.length,
      provider_ids: enabledProviderIds.join(",").slice(0, 100),
      model_ids: enabledProviderIds
        .map((providerId) => modelsByProvider[providerId] ?? PROVIDER_BY_ID[providerId].defaultModel)
        .join(",")
        .slice(0, 100),
      has_selection: Boolean(selectedText),
      selection_only: selectionOnly,
      selected_text_length: selectedText.length,
      ...getSettingsAnalyticsParams(selectedValues)
    });

    for (const pendingRun of pendingGroup.runs) {
      void (async () => {
        const startedAt = performance.now();
        try {
          const result = await runTool({
            providerId: pendingRun.providerId as ProviderId,
            apiKey: apiKeysByProvider[pendingRun.providerId] ?? "",
            model: pendingRun.model,
            tool: selectedTool,
            instruction: activePrompt,
            values: selectedValues
          });

          let shouldSelect = false;
          let autoSelectRunId: string | null = null;
          const durationMs = performance.now() - startedAt;
          const textCost = estimateCost(pendingRun.providerId as ProviderId, pendingRun.model, result.usage);
          const imageCost =
            pendingRun.providerId === "openai" &&
            result.imageGenerationSize &&
            result.imageGenerationCount
              ? estimateOpenAIImageGenerationCost(result.imageGenerationSize, result.imageGenerationCount)
              : undefined;
          const shouldHideCostEstimate =
            pendingRun.providerId === "google" && Boolean(result.imageGenerationCount);
          const cost =
            !shouldHideCostEstimate && (textCost || imageCost)
              ? {
                  inputCostUsd: textCost?.inputCostUsd,
                  outputCostUsd: textCost?.outputCostUsd,
                  imageCostUsd: imageCost?.imageCostUsd,
                  totalCostUsd: (textCost?.totalCostUsd ?? 0) + (imageCost?.totalCostUsd ?? 0),
                  pricingLabel: [textCost?.pricingLabel, imageCost?.pricingLabel].filter(Boolean).join(" + ")
                }
              : undefined;
          setRunGroups((current) =>
            current.map((group) => {
              if (group.id !== groupId) {
                return group;
              }
              const nextRuns = group.runs.map((run) =>
                run.id === pendingRun.id
                  ? {
                      ...run,
                      status: "success" as const,
                      durationMs,
                      output: result.output,
                      usage: result.usage,
                      cost,
                      imageGenerationModel: result.imageGenerationModel
                    }
                  : run
              );
              if (!group.autoSelectLocked) {
                shouldSelect = true;
                autoSelectRunId = pendingRun.id;
              }
              return { ...group, runs: nextRuns };
            })
          );

          setAnswersByResult((current) => ({ ...current, [pendingRun.id]: {} }));
          logUsageEvent({
            id: pendingRun.id,
            createdAt,
            toolId: selectedTool.id,
            toolName: selectedTool.name,
            providerId: pendingRun.providerId,
            providerLabel: pendingRun.providerLabel,
            model: pendingRun.model,
            status: "success",
            durationMs,
            selectedTextLength: selectedText.length,
            settings: selectedValues,
            usage: result.usage,
            cost,
            imageGenerationModel: result.imageGenerationModel
          });
          trackEvent("tool_run_completed", {
            tool_id: selectedTool.id,
            provider_id: pendingRun.providerId,
            model: pendingRun.model,
            duration_ms: Math.round(durationMs),
            input_tokens: result.usage?.inputTokens,
            output_tokens: result.usage?.outputTokens,
            total_tokens: result.usage?.totalTokens,
            estimated_cost_usd: cost?.totalCostUsd,
            has_selection: Boolean(selectedText),
            selection_only: selectionOnly,
            selected_text_length: selectedText.length,
            ...getSettingsAnalyticsParams(selectedValues)
          });
          if (shouldSelect && autoSelectRunId) {
            setActiveResultId(autoSelectRunId);
          }
        } catch (runError) {
          const message = runError instanceof Error ? runError.message : String(runError);
          const durationMs = performance.now() - startedAt;
          setRunGroups((current) =>
            current.map((group) =>
              group.id === groupId
                ? {
                    ...group,
                    runs: group.runs.map((run) =>
                      run.id === pendingRun.id
                        ? {
                            ...run,
                            status: "error" as const,
                            durationMs,
                            error: message
                          }
                        : run
                    )
                  }
                : group
            )
          );
          logUsageEvent({
            id: pendingRun.id,
            createdAt,
            toolId: selectedTool.id,
            toolName: selectedTool.name,
            providerId: pendingRun.providerId,
            providerLabel: pendingRun.providerLabel,
            model: pendingRun.model,
            status: "error",
            durationMs,
            selectedTextLength: selectedText.length,
            settings: selectedValues,
            error: message
          });
          trackEvent("tool_run_failed", {
            tool_id: selectedTool.id,
            provider_id: pendingRun.providerId,
            model: pendingRun.model,
            duration_ms: Math.round(durationMs),
            error_message: message.slice(0, 120),
            has_selection: Boolean(selectedText),
            selection_only: selectionOnly,
            selected_text_length: selectedText.length,
            ...getSettingsAnalyticsParams(selectedValues)
          });
        }
      })();
    }
  };

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">AI playground voor begrAIp</p>
          <h1>BegrAIp</h1>
          <p className="hero-copy">
            AI playground voor begrAIp om verschillende LLM&apos;s, prompts en outputs te testen.
          </p>
        </div>
      </header>

      <main className="workspace">
        <section className="editor-column">
          <div className="tab-row" role="tablist" aria-label="Hoofdpanelen">
            {TOP_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "input" ? (
            <>
              <div className="card controls-card">
                <div className="section-head">
                  <span>Tekst</span>
                  <strong>Leespassage en selectie</strong>
                </div>
                <label className="field-stack">
                  <span>Tekst</span>
                  <textarea
                    ref={textAreaRef}
                    className="text-area"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onSelect={updateSelectionFromTextArea}
                    onKeyUp={updateSelectionFromTextArea}
                    onMouseUp={updateSelectionFromTextArea}
                    spellCheck={false}
                  />
                </label>
                <div className="stats-row compact">
                  <div>
                    <strong>{text.trim() ? text.trim().split(/\s+/).length : 0}</strong>
                    <span>woorden</span>
                  </div>
                  <div>
                    <strong>{selectedText ? selectedText.split(/\s+/).length : 0}</strong>
                    <span>geselecteerd</span>
                  </div>
                  <div>
                    <strong>{runGroups.length}</strong>
                    <span>vergelijkingen</span>
                  </div>
                </div>
                <div className="selection-panel">
                  <div className="section-head compact section-head-with-action">
                    <div>
                      <span>Selectie</span>
                      <strong>{selectedText ? "Actieve focuspassage" : "Geen selectie"}</strong>
                    </div>
                    <button
                      type="button"
                      className="secondary-button clear-selection-button"
                      onClick={clearSelection}
                      disabled={!selectedText}
                    >
                      Selectie wissen
                    </button>
                  </div>
                  <p>
                    {selectedText
                      ? selectedText
                      : "Selecteer tekst in het veld hierboven. De volledige tekst blijft meegaan naar het model; de selectie wordt apart meegegeven als focus."}
                  </p>
                  <label className="selection-toggle">
                    <input
                      type="checkbox"
                      checked={selectionOnly}
                      onChange={(event) => {
                        setSelectionOnly(event.target.checked);
                        trackSelectionOnlyToggle(event.target.checked);
                      }}
                    />
                    <span>Alleen geselecteerde tekst naar het model sturen</span>
                  </label>
                </div>
              </div>

              <div className="card config-card">
                <div className="config-header">
                  <div>
                    <p className="eyebrow small">Actieve tool</p>
                    <h2>{selectedTool.name}</h2>
                    <p>{selectedTool.description}</p>
                    {providersWithoutImages.length ? (
                      <div className="provider-note">
                        {providersWithoutImages.map((provider) => provider.label).join(", ")} geeft hier
                        alleen beeldprompts terug. Alleen OpenAI rendert in deze playground ook direct de
                        afbeeldingen zelf.
                      </div>
                    ) : null}
                  </div>
                  <div className="run-panel">
                    <button type="button" className="run-button" onClick={runSelectedTool}>
                      {enabledProviderIds.length > 1
                        ? `Vergelijk ${enabledProviderIds.length} modellen`
                        : "Tool uitvoeren"}
                    </button>
                    <div className={`progress-chip ${pendingRuns.length ? "active" : ""}`}>
                      <span>{pendingRuns.length ? "Vergelijking loopt" : "Klaar voor run"}</span>
                      <strong>
                        {pendingRuns.length
                          ? `${pendingRuns.length} actief`
                          : `${enabledProviderIds.length} model${enabledProviderIds.length === 1 ? "" : "len"}`}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="tool-select-row">
                  <label className="field-stack">
                    <span>Tool</span>
                    <select
                      className="text-input"
                      value={selectedToolId}
                      onChange={(event) => setSelectedToolId(event.target.value)}
                    >
                      {Object.entries(
                        TOOL_CATALOG.reduce<Record<string, ToolDefinition[]>>((accumulator, tool) => {
                          accumulator[tool.category] ??= [];
                          accumulator[tool.category].push(tool);
                          return accumulator;
                        }, {})
                      ).map(([category, tools]) => (
                        <optgroup label={category} key={category}>
                          {tools.map((tool) => (
                            <option value={tool.id} key={tool.id}>
                              {tool.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <div className="provider-note">
                    {enabledProviderIds.length > 1
                      ? "Deze run wordt parallel uitgevoerd voor alle geselecteerde modellen, zodat je outputs direct kunt vergelijken."
                      : "Selecteer extra modellen in LLM's om parallel te vergelijken."}
                  </div>
                </div>

                <div className="settings-grid">
                  {selectedTool.fields.map((field) => (
                    <label className="field-stack field-panel setting-field" key={field.id}>
                      <span>{field.label}</span>
                      <div className="setting-control">
                        {field.type === "number" ? (
                          <input
                            className="text-input"
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 1}
                            value={Number(rawSelectedValues[field.id])}
                            onChange={(event) => updateValue(field, Number(event.target.value))}
                          />
                        ) : null}
                        {field.type === "select" ? (
                          <>
                            <select
                              className="text-input"
                              value={String(rawSelectedValues[field.id])}
                              onChange={(event) => updateValue(field, event.target.value)}
                            >
                              {field.options?.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <input
                              className="text-input custom-option-input"
                              type="text"
                              placeholder="Anders, namelijk..."
                              value={String(rawSelectedValues[customValueId(field.id)] ?? "")}
                              onChange={(event) => updateCustomValue(field.id, event.target.value)}
                            />
                          </>
                        ) : null}
                        {field.type === "toggle" ? (
                          <button
                            type="button"
                            className={`toggle ${rawSelectedValues[field.id] ? "on" : ""}`}
                            onClick={() => updateValue(field, !rawSelectedValues[field.id])}
                          >
                            <span className="toggle-knob" />
                            <span>{rawSelectedValues[field.id] ? "Aan" : "Uit"}</span>
                          </button>
                        ) : null}
                        {field.type === "textarea" ? (
                          <textarea
                            className="text-area setting-textarea"
                            value={String(rawSelectedValues[field.id] ?? "")}
                            onChange={(event) => updateValue(field, event.target.value)}
                          />
                        ) : null}
                      </div>
                      <small className="setting-help">{field.description ?? "\u00a0"}</small>
                    </label>
                  ))}
                </div>

                <label className="field-stack prompt-field">
                  <span>Extra instructies voor deze tool</span>
                  <textarea
                    className="text-area prompt-textarea"
                    placeholder="Voeg optionele didactische of inhoudelijke instructies toe."
                    value={customInstructions}
                    onChange={(event) =>
                      setCustomInstructionsByTool((current) => ({
                        ...current,
                        [selectedToolId]: event.target.value
                      }))
                    }
                  />
                </label>

                <details className="prompt-details">
                  <summary>Prompt onder de motorkap</summary>
                  <label className="field-stack prompt-field">
                    <span>Deze prompt wordt naar het model gestuurd</span>
                    <textarea
                      className="text-area prompt-textarea prompt-preview"
                      value={activePrompt}
                      onChange={(event) =>
                        setPromptOverridesByTool((current) => ({
                          ...current,
                          [selectedToolId]: event.target.value
                        }))
                      }
                    />
                  </label>
                  {promptOverride ? (
                    <div className="prompt-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          setPromptOverridesByTool((current) => {
                            const next = { ...current };
                            delete next[selectedToolId];
                            return next;
                          })
                        }
                      >
                        Reset naar gegenereerde prompt
                      </button>
                    </div>
                  ) : null}
                </details>

                {error ? <div className="error-banner">{error}</div> : null}
              </div>
            </>
          ) : null}

          {activeTab === "llms" ? (
            <div className="card controls-card">
              <div className="section-head">
                <span>LLM selectie</span>
                <strong>Selecteer een of meer modellen</strong>
              </div>
              <div className="provider-stack">
                {PROVIDERS.map((provider) => {
                  const enabled = enabledProviderIds.includes(provider.id);
                  return (
                    <section className={`provider-card ${enabled ? "active" : ""}`} key={provider.id}>
                      <label className="provider-toggle">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleProvider(provider.id)}
                        />
                        <div>
                          <strong>{provider.label}</strong>
                          <p>{provider.supportsImages ? "Tekst en afbeeldingen" : "Tekstoutput, beeldprompts"}</p>
                        </div>
                      </label>
                      <label className="field-stack">
                        <span>Model</span>
                        <input
                          className="text-input"
                          type="text"
                          list={`model-presets-${provider.id}`}
                          name={`llm-model-${provider.id}`}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={modelsByProvider[provider.id] ?? provider.defaultModel}
                          onChange={(event) =>
                            setModelsByProvider((current) => ({
                              ...current,
                              [provider.id]: event.target.value
                            }))
                          }
                        />
                        <datalist id={`model-presets-${provider.id}`}>
                          {PROVIDER_MODEL_PRESETS[provider.id]?.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </datalist>
                        {PROVIDER_MODEL_PRESETS[provider.id]?.length ? (
                          <div className="model-preset-row">
                            {PROVIDER_MODEL_PRESETS[provider.id].map((preset) => (
                              <button
                                type="button"
                                key={preset.id}
                                className={`preset-pill ${modelsByProvider[provider.id] === preset.id ? "active" : ""}`}
                                onClick={() =>
                                  setModelsByProvider((current) => ({
                                    ...current,
                                    [provider.id]: preset.id
                                  }))
                                }
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {(provider.id === "google" || provider.id === "anthropic") ? (
                          <small className="setting-help">
                            {provider.id === "google"
                              ? "Voor betaalde Gemini-modellen heb je een actief billing account nodig. Kosten gebruiken Gemini API standaardtarieven."
                              : "Anthropic API gebruikt betaalde modellen. Kosten gebruiken officiële Anthropic tokenprijzen voor de aangeboden modelreeksen."}
                          </small>
                        ) : null}
                      </label>
                      <label className="field-stack">
                        <span>API key</span>
                        <input
                          className="text-input"
                          type="password"
                          name={`api-key-${provider.id}`}
                          autoComplete="new-password"
                          placeholder={provider.keyPlaceholder}
                          value={apiKeysByProvider[provider.id] ?? ""}
                          onChange={(event) =>
                            setApiKeysByProvider((current) => ({
                              ...current,
                              [provider.id]: event.target.value
                            }))
                          }
                        />
                      </label>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeTab === "runs" ? (
            <div className="card controls-card">
              <div className="section-head section-head-with-action">
                <div>
                  <span>Vergelijkingen</span>
                  <strong>Resultaten per prompt</strong>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={exportSessionResults}
                  disabled={!runGroups.length}
                >
                  Exporteer sessie-JSON
                </button>
              </div>
              <div className="run-group-list">
                {runGroups.length ? (
                  runGroups.map((group) => {
                    const pendingCount = group.runs.filter((run) => run.status === "pending").length;
                    const successCount = group.runs.filter((run) => run.status === "success").length;
                    const errorCount = group.runs.filter((run) => run.status === "error").length;
                    return (
                      <section className={`run-group ${pendingCount ? "pending" : ""}`} key={group.id}>
                        <div className="run-group-head">
                          <div>
                            <strong>{group.toolName}</strong>
                            <p>{formatClockTime(group.createdAt)}</p>
                          </div>
                          <div className="run-group-meta">
                            <span>{pendingCount ? formatDuration(nowMs - group.createdAt) : "Afgerond"}</span>
                            <span>
                              {successCount} klaar · {errorCount} fout · {pendingCount} bezig
                            </span>
                          </div>
                        </div>
                        <div className="group-pill-row">
                          {group.selectedText ? <span className="pill">Selectie actief</span> : null}
                          {TOOL_BY_ID[group.toolId].fields.map((field) => (
                            <span key={field.id} className="pill">
                              {field.label}: {formatSetting(field, group.settings[field.id])}
                            </span>
                          ))}
                        </div>
                        <div className="group-run-grid">
                          {group.runs.map((run) => (
                            <button
                              type="button"
                              key={run.id}
                              className={`run-status-card ${getRunTone(run)} ${run.id === activeResult?.id ? "active" : ""}`}
                              onClick={() => {
                                if (run.status !== "success") {
                                  return;
                                }
                                trackEvent("result_selected", {
                                  tool_id: group.toolId,
                                  provider_id: run.providerId,
                                  model: run.model
                                });
                                setRunGroups((current) =>
                                  current.map((entry) =>
                                    entry.id === group.id ? { ...entry, autoSelectLocked: true } : entry
                                  )
                                );
                                setActiveResultId(run.id);
                              }}
                            >
                              <strong>
                                {run.providerLabel} · {run.model}
                              </strong>
                              <p>
                                {run.status === "pending"
                                  ? `Bezig... ${formatDuration(nowMs - run.createdAt)}`
                                  : run.status === "success"
                                    ? `Klaar in ${formatDuration(run.durationMs ?? 0)}`
                                    : run.error}
                              </p>
                              {run.status !== "pending" ? (
                                <small className="token-meta">
                                  {formatTokenBreakdown(run.usage)}
                                </small>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <div className="empty-history">Nog geen vergelijkingen gestart.</div>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="results-column">
          <div className="card result-card">
            <div className="section-head">
              <span>Output</span>
              <strong>Actieve run</strong>
            </div>

            {activeResult && activeOutput ? (
              <>
                <div className="result-intro">
                  <div>
                    <p className="eyebrow small">
                      {activeResult.toolName} · {activeResult.providerLabel}
                    </p>
                    <h2>{activeOutput.title}</h2>
                    <p>{activeOutput.summary}</p>
                  </div>
                  <div className="result-timing">
                    <time>{formatClockTime(activeResult.createdAt)}</time>
                    <strong>{formatDuration(activeResult.durationMs ?? 0)}</strong>
                  </div>
                </div>

                <div className="pill-row">
                  <span className="pill">Model: {activeResult.model}</span>
                  {activeResult.imageGenerationModel &&
                  activeResult.imageGenerationModel !== activeResult.model ? (
                    <span className="pill">Beeldmodel: {activeResult.imageGenerationModel}</span>
                  ) : null}
                  <span className="pill">
                    {formatTokenBreakdown(activeResult.usage)}
                  </span>
                  <span className="pill">
                    {formatCostBreakdown(activeResult.cost)}
                  </span>
                  <span className="pill">{costDisclaimer}</span>
                  {activeResult.selectedText ? <span className="pill">Selectie actief</span> : null}
                </div>

                {activeResult.selectedText && activeResult.toolId !== "word-highlighter" ? (
                  <section className="content-block selection-result">
                    <h3>Geselecteerde passage</h3>
                    <p>{activeResult.selectedText}</p>
                  </section>
                ) : null}

                {activeOutput.highlights?.length ? (
                  <section className="content-block source-preview">
                    <div className="section-head compact">
                      <span>Brontekst met markeringen</span>
                      <strong>{activeResult.providerLabel}</strong>
                    </div>
                    <div className="highlight-legend">
                      {activeOutput.highlights.map((group) => (
                        <span key={group.label} className={`legend-pill ${group.color}`}>
                          {group.label}
                        </span>
                      ))}
                    </div>
                    <div className="source-preview-text">
                      {sourceTokens.map((token) => {
                        const highlight = token.wordId ? highlightedWordMap.get(token.wordId) : undefined;
                        const reference = token.wordId ? referenceSourceMap.get(token.wordId) : undefined;
                        const isReferenceSource = token.wordId === activeReferenceSourceTokenId;
                        const isReferenceTarget = token.wordId ? activeReferenceTargetIds.has(token.wordId) : false;
                        const className = [
                          highlight ? `token-highlight ${highlight.color}` : "",
                          reference ? "token-reference-source" : "",
                          isReferenceSource ? "token-reference-source-active" : "",
                          isReferenceTarget ? "token-reference-target" : ""
                        ]
                          .filter(Boolean)
                          .join(" ");

                        if (reference && token.wordId) {
                          return (
                            <button
                              type="button"
                              key={token.key}
                              className={`token-inline-button ${className}`}
                              title={reference.label ?? highlight?.label}
                              onClick={() => {
                                trackEvent("reference_clicked", {
                                  tool_id: activeResult?.toolId,
                                  provider_id: activeResult?.providerId,
                                  target_count: reference.targetTokenIds.length
                                });
                                setActiveReferenceSourceTokenId((current) =>
                                  current === token.wordId ? null : token.wordId!
                                );
                              }}
                            >
                              {token.text}
                            </button>
                          );
                        }

                        return (
                          <span key={token.key} className={className || undefined} title={highlight?.label}>
                            {token.text}
                          </span>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {activeOutput.sections?.map((section) => (
                  <section className="content-block" key={section.label}>
                    <h3>{section.label}</h3>
                    {renderStructuredText(section.body)}
                  </section>
                ))}

                {activeOutput.timeline?.length ? (
                  <section className="content-block">
                    <h3>Tijdlijn</h3>
                    <div className="timeline-grid">
                      {activeOutput.timeline.map((item, index) => (
                        <article className="timeline-card" key={`${item.title}-${index}`}>
                          <div className="timeline-step">{index + 1}</div>
                          <div className="timeline-copy">
                            <strong>{item.title}</strong>
                            {item.detail ? <p>{item.detail}</p> : null}
                            {(item.cause || item.effect) ? (
                              <div className="cause-effect-grid">
                                {item.cause ? (
                                  <div className="cause-effect-block">
                                    <span>Oorzaak</span>
                                    <p>{item.cause}</p>
                                  </div>
                                ) : null}
                                {item.effect ? (
                                  <div className="cause-effect-block">
                                    <span>Gevolg</span>
                                    <p>{item.effect}</p>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeOutput.bullets?.length &&
                activeResult.toolId !== "open-questions" &&
                activeResult.toolId !== "character-map" ? (
                  <section className="content-block">
                    <h3>Kernpunten</h3>
                    <ul className="bullet-list">
                      {activeOutput.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {activeOutput.glossary?.length ? (
                  <section className="content-block">
                    <h3>Woordenlijst</h3>
                    <div className="glossary-grid">
                      {activeOutput.glossary.map((item) => (
                        <article className="glossary-card" key={item.term}>
                          <div className="glossary-head">
                            <strong>{item.term}</strong>
                            {item.category ? <span>{item.category}</span> : null}
                          </div>
                          <p>{item.definition}</p>
                          {item.example ? <small>{item.example}</small> : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeOutput.images?.length ? (
                  <section className="content-block">
                    <h3>Beelden</h3>
                    <div className="image-grid">
                      {activeOutput.images.map((image) => (
                        <article className="image-card" key={image.title}>
                          <div
                            className={`image-frame ${image.aspectRatio === "1024x1536" ? "portrait" : image.aspectRatio === "1024x1024" ? "square" : "landscape"}`}
                          >
                            {image.imageUrl ? (
                              <img src={image.imageUrl} alt={image.alt} />
                            ) : (
                              <div className="image-placeholder">Geen afbeelding</div>
                            )}
                          </div>
                          <strong>{image.title}</strong>
                          <p>{image.alt}</p>
                          <code>{image.prompt}</code>
                          {image.imageError ? <small className="error-text">{image.imageError}</small> : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeOutput.quiz && getSafeQuizQuestions(activeOutput.quiz.questions).length ? (
                  <section className="content-block">
                    <div className="quiz-head">
                      <div>
                        <h3>{activeOutput.quiz.title}</h3>
                        {activeOutput.quiz.instructions ? <p>{activeOutput.quiz.instructions}</p> : null}
                      </div>
                      {quizScore ? (
                        <div className="score-box">
                          <strong>
                            {quizScore.correct}/{quizScore.total}
                          </strong>
                          <span>{quizScore.answered} beantwoord</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="quiz-list">
                      {getSafeQuizQuestions(activeOutput.quiz.questions).map((question, questionIndex) => {
                        const selectedAnswer = answersByResult[activeResult.id]?.[questionIndex];
                        const isAnswered = selectedAnswer !== undefined;
                        const feedback = getQuizFeedback(question);

                        return (
                          <article className="quiz-card" key={`${activeResult.id}-${question.prompt}`}>
                            <strong>
                              {questionIndex + 1}. {question.prompt}
                            </strong>
                            <div className="choice-list">
                              {question.choices.map((choice, choiceIndex) => {
                                const selected = selectedAnswer === choiceIndex;
                                const correct = question.correctIndex === choiceIndex;
                                const reveal = isAnswered && (selected || correct);
                                return (
                                  <button
                                    type="button"
                                    key={choice}
                                    className={`choice-button ${selected ? "selected" : ""} ${reveal ? (correct ? "correct" : "wrong") : ""}`}
                                    onClick={() => updateAnswer(activeResult.id, questionIndex, choiceIndex)}
                                  >
                                    <span>{String.fromCharCode(65 + choiceIndex)}</span>
                                    <span>{choice}</span>
                                  </button>
                                );
                              })}
                            </div>
                            {isAnswered ? (
                              <div className="quiz-feedback">
                                {selectedAnswer !== question.correctIndex &&
                                feedback.wrongExplanations[selectedAnswer] ? (
                                  <p className="explanation">
                                    <strong>Waarom dit antwoord fout is:</strong>{" "}
                                    {feedback.wrongExplanations[selectedAnswer]}
                                  </p>
                                ) : null}
                                {feedback.correctExplanation ? (
                                  <p className="explanation">
                                    <strong>Waarom het goede antwoord klopt:</strong>{" "}
                                    {feedback.correctExplanation}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <details className="prompt-details result-prompt">
                  <summary>Bekijk gebruikte prompt</summary>
                  <pre>{activeResult.prompt}</pre>
                </details>
              </>
            ) : (
              <div className="empty-state">
                <strong>{pendingRuns.length ? "Vergelijking bezig" : "Nog geen output"}</strong>
                <p>
                  {pendingRuns.length
                    ? "De eerste geslaagde output verschijnt hier automatisch zodra een model antwoord geeft."
                    : "Start links een vergelijking of kies een geslaagde run in Resultaten."}
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};
