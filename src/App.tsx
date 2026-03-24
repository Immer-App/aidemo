import { useEffect, useMemo, useState } from "react";
import { DEFAULT_API_KEYS, PROVIDER_BY_ID, PROVIDERS, runTool } from "./openai";
import { TOOL_CATALOG, TOOL_BY_ID } from "./toolCatalog";
import type { ProviderId } from "./openai";
import type { RunResult, ToolDefinition, ToolField } from "./types";

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

type TopTab = "texts" | "llms" | "runs";

const TOP_TABS: Array<{ id: TopTab; label: string }> = [
  { id: "texts", label: "Texts" },
  { id: "llms", label: "LLM settings" },
  { id: "runs", label: "Recent runs" }
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

export const App = () => {
  const [activeTab, setActiveTab] = useState<TopTab>("texts");
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
  const [results, setResults] = useState<RunResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [answersByResult, setAnswersByResult] = useState<Record<string, Record<number, number>>>({});
  const [loading, setLoading] = useState(false);
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [loadingElapsedMs, setLoadingElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
    if (!loadingStartedAt) {
      setLoadingElapsedMs(0);
      return;
    }

    setLoadingElapsedMs(Date.now() - loadingStartedAt);
    const intervalId = window.setInterval(() => {
      setLoadingElapsedMs(Date.now() - loadingStartedAt);
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [loadingStartedAt]);

  useEffect(() => {
    setSelectedRange((current) => ({
      start: Math.min(current.start, text.length),
      end: Math.min(current.end, text.length)
    }));
  }, [text]);

  const selectedTool = TOOL_BY_ID[selectedToolId] as ToolDefinition;
  const rawSelectedValues = valuesByTool[selectedToolId];
  const selectedValues = useMemo(
    () => resolveToolValues(selectedTool, rawSelectedValues),
    [rawSelectedValues, selectedTool]
  );
  const customInstructions = customInstructionsByTool[selectedToolId] ?? "";
  const selectedText = getSelection(text, selectedRange.start, selectedRange.end);
  const generatedPrompt = selectedTool.buildInstruction({
    text,
    selectedText,
    values: selectedValues,
    customInstructions
  });
  const activePrompt = promptOverridesByTool[selectedToolId] ?? generatedPrompt;
  const activeResult = results.find((result) => result.id === activeResultId) ?? results[0] ?? null;

  const runLabel =
    enabledProviderIds.length > 1
      ? `Vergelijk ${enabledProviderIds.length} modellen`
      : "Tool uitvoeren";

  const quizScore = (() => {
    if (!activeResult?.output.quiz) {
      return null;
    }
    const answers = answersByResult[activeResult.id] ?? {};
    const correct = activeResult.output.quiz.questions.reduce((score, question, index) => {
      return score + (answers[index] === question.correctIndex ? 1 : 0);
    }, 0);
    return {
      correct,
      total: activeResult.output.quiz.questions.length,
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

    setLoading(true);
    setLoadingStartedAt(Date.now());
    setError(null);

    const settledRuns = await Promise.allSettled(
      enabledProviderIds.map(async (providerId) => {
        const provider = PROVIDER_BY_ID[providerId];
        const apiKey = apiKeysByProvider[providerId] ?? "";
        const model = modelsByProvider[providerId] ?? provider.defaultModel;
        const startedAt = performance.now();
        const output = await runTool({
          providerId,
          apiKey,
          model,
          tool: selectedTool,
          instruction: activePrompt,
          values: selectedValues
        });

        const run: RunResult = {
          id: createRunId(),
          toolId: selectedTool.id,
          toolName: selectedTool.name,
          createdAt: Date.now(),
          providerId,
          providerLabel: provider.label,
          model,
          durationMs: performance.now() - startedAt,
          prompt: activePrompt,
          selectedText: selectedText || undefined,
          settings: selectedValues,
          output
        };

        return run;
      })
    );

    const successfulRuns: RunResult[] = [];
    const failedRuns: string[] = [];

    settledRuns.forEach((result, index) => {
      if (result.status === "fulfilled") {
        successfulRuns.push(result.value);
        return;
      }
      failedRuns.push(`${PROVIDER_BY_ID[enabledProviderIds[index]].label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });

    if (successfulRuns.length) {
      setResults((current) => [...successfulRuns, ...current]);
      setActiveResultId(successfulRuns[0].id);
      setAnswersByResult((current) => ({
        ...current,
        ...Object.fromEntries(successfulRuns.map((run) => [run.id, {}]))
      }));
      setActiveTab("runs");
    }

    if (failedRuns.length) {
      setError(failedRuns.join(" "));
    }

    setLoading(false);
    setLoadingStartedAt(null);
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

          {activeTab === "texts" ? (
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
                  <strong>{results.length}</strong>
                  <span>runs</span>
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
            </div>
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
                <span>Historie</span>
                <strong>Recente runs</strong>
              </div>
              <div className="history-list">
                {results.length ? (
                  results.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      className={`history-item ${result.id === activeResultId ? "active" : ""}`}
                      onClick={() => setActiveResultId(result.id)}
                    >
                      <strong>{result.toolName}</strong>
                      <p>
                        {result.providerLabel} · {result.model}
                      </p>
                      <span>
                        {formatClockTime(result.createdAt)} · {formatDuration(result.durationMs)}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="empty-history">Nog geen runs opgeslagen.</div>
                )}
              </div>
            </div>
          ) : null}

          <div className="card config-card">
            <div className="config-header">
              <div>
                <p className="eyebrow small">Actieve tool</p>
                <h2>{selectedTool.name}</h2>
                <p>{selectedTool.description}</p>
              </div>
              <div className="run-panel">
                <button type="button" className="run-button" onClick={runSelectedTool} disabled={loading}>
                  {loading ? "Bezig..." : runLabel}
                </button>
                <div className={`progress-chip ${loading ? "active" : ""}`}>
                  <span>{loading ? "Bezig met genereren" : "Klaar voor run"}</span>
                  <strong>{loading ? formatDuration(loadingElapsedMs) : `${enabledProviderIds.length} model${enabledProviderIds.length === 1 ? "" : "len"}`}</strong>
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
                  : "Selecteer extra modellen in LLM settings om parallel te vergelijken."}
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

            <details className="prompt-details" open>
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
                <span>{promptOverridesByTool[selectedToolId] ? "Aangepaste prompt actief" : "Automatisch gegenereerde prompt actief"}</span>
              </div>
            </details>

            {error ? <div className="error-banner">{error}</div> : null}
          </div>
        </section>

        <aside className="results-column">
          <div className="card result-card">
            <div className="section-head">
              <span>Output</span>
              <strong>Actieve run</strong>
            </div>

            {activeResult ? (
              <>
                <div className="result-intro">
                  <div>
                    <p className="eyebrow small">
                      {activeResult.toolName} · {activeResult.providerLabel}
                    </p>
                    <h2>{activeResult.output.title}</h2>
                    <p>{activeResult.output.summary}</p>
                  </div>
                  <div className="result-timing">
                    <time>{formatClockTime(activeResult.createdAt)}</time>
                    <strong>{formatDuration(activeResult.durationMs)}</strong>
                  </div>
                </div>

                <div className="pill-row">
                  <span className="pill">Model: {activeResult.model}</span>
                  {activeResult.selectedText ? <span className="pill">Selectie actief</span> : null}
                  {TOOL_BY_ID[activeResult.toolId].fields.map((field) => (
                    <span key={field.id} className="pill">
                      {field.label}: {formatSetting(field, activeResult.settings[field.id])}
                    </span>
                  ))}
                </div>

                {activeResult.selectedText ? (
                  <section className="content-block selection-result">
                    <h3>Geselecteerde passage</h3>
                    <p>{activeResult.selectedText}</p>
                  </section>
                ) : null}

                {activeResult.output.sections?.map((section) => (
                  <section className="content-block" key={section.label}>
                    <h3>{section.label}</h3>
                    <p>{section.body}</p>
                  </section>
                ))}

                {activeResult.output.bullets?.length ? (
                  <section className="content-block">
                    <h3>Kernpunten</h3>
                    <ul className="bullet-list">
                      {activeResult.output.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {activeResult.output.glossary?.length ? (
                  <section className="content-block">
                    <h3>Woordenlijst</h3>
                    <div className="glossary-grid">
                      {activeResult.output.glossary.map((item) => (
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

                {activeResult.output.images?.length ? (
                  <section className="content-block">
                    <h3>Beelden</h3>
                    <div className="image-grid">
                      {activeResult.output.images.map((image) => (
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

                {activeResult.output.quiz ? (
                  <section className="content-block">
                    <div className="quiz-head">
                      <div>
                        <h3>{activeResult.output.quiz.title}</h3>
                        {activeResult.output.quiz.instructions ? (
                          <p>{activeResult.output.quiz.instructions}</p>
                        ) : null}
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
                      {activeResult.output.quiz.questions.map((question, questionIndex) => {
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
                <strong>{loading ? "Run bezig" : "Nog geen output"}</strong>
                <p>
                  {loading
                    ? `De geselecteerde modellen zijn bezig. Huidige looptijd: ${formatDuration(loadingElapsedMs)}.`
                    : "Voer links een tool uit om hier het resultaat te zien."}
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};
