import { useEffect, useMemo, useState } from "react";
import { DEFAULT_API_KEYS, PROVIDER_BY_ID, PROVIDERS, runTool } from "./openai";
import { TOOL_CATALOG, TOOL_BY_ID } from "./toolCatalog";
import type { RunResult, ToolDefinition, ToolField } from "./types";

const PROVIDER_STORAGE_KEY = "begraip-provider";
const API_KEY_STORAGE_KEY = "begraip-api-keys";
const MODEL_STORAGE_KEY = "begraip-models";
const DEMO_TEXT = `Op een winderige ochtend liep Amir met zijn oma over de dijk langs de rivier. 
De lucht was grijs, maar op het water dreven glinsterende strepen licht. 
Oma vertelde dat de rivier al eeuwenlang belangrijk was voor het dorp: vissers verdienden er hun brood, handelaren brachten goederen mee en kinderen leerden aan de oever zwemmen.

Bij het oude gemaal bleef Amir staan. Hij zag een verweerd bord met onbekende woorden als "stoomketel" en "waterpeil". 
"Waarom is dit gebouw zo belangrijk?" vroeg hij.

"Omdat mensen hier vroeger slim moesten samenwerken," zei oma. "Als het water te hoog kwam, overstroomden de straten. Dit gemaal hielp het dorp droog te houden."

Amir keek nog eens naar de rivier. Opeens begreep hij dat het water niet alleen mooi was, maar ook machtig. 
Wat vanzelfsprekend leek, bleek het resultaat van veel kennis, werk en keuzes van mensen uit het verleden.`;

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

export const App = () => {
  const [providerId, setProviderId] = useState<keyof typeof PROVIDER_BY_ID>("openai");
  const [apiKeysByProvider, setApiKeysByProvider] = useState<Record<string, string>>(() => ({
    ...DEFAULT_API_KEYS
  }));
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.defaultModel]))
  );
  const [text, setText] = useState(DEMO_TEXT);
  const [selectedToolId, setSelectedToolId] = useState(TOOL_CATALOG[0].id);
  const [valuesByTool, setValuesByTool] = useState<Record<string, Record<string, string | number | boolean>>>(
    () =>
      Object.fromEntries(TOOL_CATALOG.map((tool) => [tool.id, { ...tool.defaults }]))
  );
  const [results, setResults] = useState<RunResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [answersByResult, setAnswersByResult] = useState<Record<string, Record<number, number>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedProviderId = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (savedProviderId && savedProviderId in PROVIDER_BY_ID) {
      setProviderId(savedProviderId as keyof typeof PROVIDER_BY_ID);
    }

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
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, providerId);
  }, [providerId]);

  useEffect(() => {
    window.localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(apiKeysByProvider));
  }, [apiKeysByProvider]);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(modelsByProvider));
  }, [modelsByProvider]);

  const selectedProvider = PROVIDER_BY_ID[providerId];
  const apiKey = apiKeysByProvider[providerId] ?? "";
  const model = modelsByProvider[providerId] ?? selectedProvider.defaultModel;
  const selectedTool = TOOL_BY_ID[selectedToolId] as ToolDefinition;
  const selectedValues = valuesByTool[selectedToolId];
  const activeResult = results.find((result) => result.id === activeResultId) ?? results[0] ?? null;

  const groupedTools = useMemo(() => {
    return TOOL_CATALOG.reduce<Record<string, ToolDefinition[]>>((accumulator, tool) => {
      accumulator[tool.category] ??= [];
      accumulator[tool.category].push(tool);
      return accumulator;
    }, {});
  }, []);

  const runSelectedTool = async () => {
    if (!text.trim()) {
      setError("Plak eerst een tekst in de playground.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const output = await runTool({
        providerId,
        apiKey,
        model,
        text,
        tool: selectedTool,
        values: selectedValues
      });

      const run: RunResult = {
        id: createRunId(),
        toolId: selectedTool.id,
        toolName: selectedTool.name,
        createdAt: Date.now(),
        providerId,
        providerLabel: selectedProvider.label,
        model,
        settings: selectedValues,
        output
      };

      setResults((current) => [run, ...current]);
      setActiveResultId(run.id);
      setAnswersByResult((current) => ({ ...current, [run.id]: {} }));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setLoading(false);
    }
  };

  const updateValue = (field: ToolField, nextValue: string | number | boolean) => {
    setValuesByTool((current) => ({
      ...current,
      [selectedToolId]: {
        ...current[selectedToolId],
        [field.id]: nextValue
      }
    }));
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

  return (
    <div className="page-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <header className="hero">
        <div>
          <p className="eyebrow">AI PLAYGROUND VOOR BEGRIJPEND LEZEN</p>
          <h1>BegrAIp</h1>
          <p className="hero-copy">
            Plak een tekst, kies een tool en laat AI direct lesmateriaal, visualisaties en
            diagnose-instrumenten genereren.
          </p>
        </div>
        <div className="hero-panel">
          <div className="hero-metric">
            <strong>9</strong>
            <span>didactische tools</span>
          </div>
          <div className="hero-metric">
            <strong>1</strong>
            <span>centrale tekstbron</span>
          </div>
          <div className="hero-metric">
            <strong>∞</strong>
            <span>variaties per instelling</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar card">
          <div className="section-head">
            <span>Toolset</span>
            <strong>Kies je werkvorm</strong>
          </div>

          {Object.entries(groupedTools).map(([category, tools]) => (
            <section className="tool-group" key={category}>
              <h2>{category}</h2>
              <div className="tool-list">
                {tools.map((tool) => (
                  <button
                    type="button"
                    key={tool.id}
                    className={`tool-card ${tool.id === selectedToolId ? "active" : ""}`}
                    onClick={() => setSelectedToolId(tool.id)}
                    style={{ "--tool-accent": tool.accent } as React.CSSProperties}
                  >
                    <div className="tool-card-top">
                      <span className="tool-icon">{tool.icon}</span>
                      <span className="tool-tag">{tool.category}</span>
                    </div>
                    <strong>{tool.name}</strong>
                    <p>{tool.tagline}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <section className="editor-column">
          <div className="card controls-card">
            <div className="section-head">
              <span>Brontekst</span>
              <strong>Werk vanuit een centrale leespassage</strong>
            </div>
            <div className="provider-grid">
              <label className="field-stack provider-field">
                <span>LLM-aanbieder</span>
                <select
                  className="text-input"
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value as keyof typeof PROVIDER_BY_ID)}
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-stack provider-field">
                <span>Model</span>
                <input
                  className="text-input"
                  type="text"
                  value={model}
                  onChange={(event) =>
                    setModelsByProvider((current) => ({
                      ...current,
                      [providerId]: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <label className="field-stack provider-key-panel">
              <span>{selectedProvider.label} API key</span>
              <input
                className="text-input"
                type="password"
                placeholder={selectedProvider.keyPlaceholder}
                value={apiKey}
                onChange={(event) =>
                  setApiKeysByProvider((current) => ({
                    ...current,
                    [providerId]: event.target.value
                  }))
                }
              />
              <small>
                Elke aanbieder bewaart zijn eigen key en model lokaal in deze browser.
              </small>
              <small className="provider-warning">
                Op GitHub Pages draait deze app volledig client-side. Gebruik hier geen gedeelde of
                permanente productie-keys; zet voor echt veilig gebruik een backend-proxy ertussen.
              </small>
            </label>
            <label className="field-stack">
              <span>Tekst</span>
              <textarea
                className="text-area"
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="stats-row">
              <div>
                <strong>{text.trim() ? text.trim().split(/\s+/).length : 0}</strong>
                <span>woorden</span>
              </div>
              <div>
                <strong>{text.length}</strong>
                <span>tekens</span>
              </div>
              <div>
                <strong>{results.length}</strong>
                <span>runs</span>
              </div>
            </div>
          </div>

          <div className="card config-card">
            <div className="config-header">
              <div>
                <p className="eyebrow small">Actieve tool</p>
                <h2>{selectedTool.name}</h2>
                <p>{selectedTool.description}</p>
                {selectedTool.outputKind === "images" && !selectedProvider.supportsImages ? (
                  <div className="provider-note">
                    {selectedProvider.label} genereert hier wel beeldprompts, maar geen echte afbeeldingen.
                    Kies `OpenAI` als je direct beelden wilt laten renderen.
                  </div>
                ) : null}
              </div>
              <button type="button" className="run-button" onClick={runSelectedTool} disabled={loading}>
                {loading ? "Bezig..." : "Tool uitvoeren"}
              </button>
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
                        value={Number(selectedValues[field.id])}
                        onChange={(event) => updateValue(field, Number(event.target.value))}
                      />
                    ) : null}
                    {field.type === "select" ? (
                      <select
                        className="text-input"
                        value={String(selectedValues[field.id])}
                        onChange={(event) => updateValue(field, event.target.value)}
                      >
                        {field.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {field.type === "toggle" ? (
                      <button
                        type="button"
                        className={`toggle ${selectedValues[field.id] ? "on" : ""}`}
                        onClick={() => updateValue(field, !selectedValues[field.id])}
                      >
                        <span className="toggle-knob" />
                        <span>{selectedValues[field.id] ? "Aan" : "Uit"}</span>
                      </button>
                    ) : null}
                  </div>
                  <small className="setting-help">{field.description ?? "\u00a0"}</small>
                </label>
              ))}
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
          </div>
        </section>

        <aside className="results-column">
          <div className="card result-card">
            <div className="section-head">
              <span>Resultaten</span>
              <strong>Actieve output</strong>
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
                  <time>{new Date(activeResult.createdAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</time>
                </div>

                <div className="pill-row">
                  <span className="pill">Model: {activeResult.model}</span>
                  {TOOL_BY_ID[activeResult.toolId].fields.map((field) => (
                    <span key={field.id} className="pill">
                      {field.label}: {formatSetting(field, activeResult.settings[field.id])}
                    </span>
                  ))}
                </div>

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
                          <div className="image-frame">
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
              </>
            ) : (
              <div className="empty-state">
                <strong>Nog geen output</strong>
                <p>Voer links een tool uit om hier het resultaat te zien.</p>
              </div>
            )}
          </div>

          <div className="card history-card">
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
                    <p>{result.output.title}</p>
                    <span>
                      {new Date(result.createdAt).toLocaleTimeString("nl-NL", {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-history">Nog geen runs opgeslagen.</div>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};
