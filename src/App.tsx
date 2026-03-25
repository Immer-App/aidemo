import { useEffect, useMemo, useState } from "react";
import { DEFAULT_API_KEYS, PROVIDER_BY_ID, PROVIDERS, runTool } from "./openai";
import { TOOL_CATALOG, TOOL_BY_ID } from "./toolCatalog";
import type { ProviderId } from "./openai";
import type { QuizQuestion, RunGroup, RunResult, ToolDefinition, ToolField } from "./types";

const API_KEY_STORAGE_KEY = "begraip-api-keys";
const MODEL_STORAGE_KEY = "begraip-models";
const ENABLED_PROVIDER_STORAGE_KEY = "begraip-enabled-providers";
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
const customValueId = (fieldId: string) => `${fieldId}__custom`;

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

export const App = () => {
  const [activeTab, setActiveTab] = useState<TopTab>("input");
  const [apiKeysByProvider, setApiKeysByProvider] = useState<Record<string, string>>(() => ({
    ...DEFAULT_API_KEYS
  }));
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.defaultModel]))
  );
  const [enabledProviderIds, setEnabledProviderIds] = useState<ProviderId[]>(["openai"]);
  const [text, setText] = useState(DEMO_TEXT);
  const [selectedRange, setSelectedRange] = useState({ start: 0, end: 0 });
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
    tokenMap
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
    setEnabledProviderIds((current) =>
      current.includes(providerId)
        ? current.filter((item) => item !== providerId)
        : [...current, providerId]
    );
  };

  const updateSelectionFromTextArea = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    setSelectedRange({
      start: target.selectionStart,
      end: target.selectionEnd
    });
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
    setActiveTab("runs");
    setError(null);

    for (const pendingRun of pendingGroup.runs) {
      void (async () => {
        const startedAt = performance.now();
        try {
          const output = await runTool({
            providerId: pendingRun.providerId as ProviderId,
            apiKey: apiKeysByProvider[pendingRun.providerId] ?? "",
            model: pendingRun.model,
            tool: selectedTool,
            instruction: activePrompt,
            values: selectedValues
          });

          let shouldSelect = false;
          setRunGroups((current) =>
            current.map((group) => {
              if (group.id !== groupId) {
                return group;
              }
              const hadSuccess = group.runs.some((run) => run.status === "success");
              const nextRuns = group.runs.map((run) =>
                run.id === pendingRun.id
                  ? {
                      ...run,
                      status: "success" as const,
                      durationMs: performance.now() - startedAt,
                      output
                    }
                  : run
              );
              if (!hadSuccess) {
                shouldSelect = true;
              }
              return { ...group, runs: nextRuns };
            })
          );

          setAnswersByResult((current) => ({ ...current, [pendingRun.id]: {} }));
          if (shouldSelect) {
            setActiveResultId(pendingRun.id);
          }
        } catch (runError) {
          const message = runError instanceof Error ? runError.message : String(runError);
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
                            durationMs: performance.now() - startedAt,
                            error: message
                          }
                        : run
                    )
                  }
                : group
            )
          );
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
                  <div className="section-head compact">
                    <span>Selectie</span>
                    <strong>{selectedText ? "Actieve focuspassage" : "Geen selectie"}</strong>
                  </div>
                  <p>
                    {selectedText
                      ? selectedText
                      : "Selecteer tekst in het veld hierboven. De volledige tekst blijft meegaan naar het model; de selectie wordt apart meegegeven als focus."}
                  </p>
                </div>

                {activeOutput?.highlights?.length ? (
                  <div className="source-preview">
                    <div className="section-head compact">
                      <span>Brontekst met markeringen</span>
                      <strong>{activeResult?.providerLabel}</strong>
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
                        return (
                          <span
                            key={token.key}
                            className={highlight ? `token-highlight ${highlight.color}` : undefined}
                            title={highlight?.label}
                          >
                            {token.text}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
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
              <div className="section-head">
                <span>Vergelijkingen</span>
                <strong>Resultaten per prompt</strong>
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
                              className={`run-status-card ${getRunTone(run)} ${run.id === activeResultId ? "active" : ""}`}
                              onClick={() => run.status === "success" && setActiveResultId(run.id)}
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
                  {activeResult.selectedText ? <span className="pill">Selectie actief</span> : null}
                </div>

                {activeResult.selectedText ? (
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
                        return (
                          <span
                            key={token.key}
                            className={highlight ? `token-highlight ${highlight.color}` : undefined}
                            title={highlight?.label}
                          >
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
                    <p>{section.body}</p>
                  </section>
                ))}

                {activeOutput.bullets?.length ? (
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
                            {isAnswered && question.explanation ? (
                              <p className="explanation">{question.explanation}</p>
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
