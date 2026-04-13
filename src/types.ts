export type FieldType = "number" | "select" | "toggle" | "textarea";

export type FieldOption = {
  label: string;
  value: string;
};

export type ToolField = {
  id: string;
  label: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
  description?: string;
};

export type ToolDefinition = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  accent: string;
  icon: string;
  outputKind: "quiz" | "glossary" | "images" | "report";
  fields: ToolField[];
  defaults: Record<string, string | number | boolean>;
  buildInstruction: (input: {
    text: string;
    selectedText?: string;
    values: Record<string, string | number | boolean>;
    customInstructions?: string;
    tokenMap?: string;
    selectionOnly?: boolean;
  }) => string;
};

export type QuizQuestion = {
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
  correctExplanation?: string;
  wrongExplanations?: string[];
};

export type GlossaryEntry = {
  term: string;
  definition: string;
  category?: string;
  example?: string;
};

export type ImageAsset = {
  title: string;
  prompt: string;
  alt: string;
  aspectRatio?: string;
  imageUrl?: string;
  imageError?: string;
};

export type ToolOutput = {
  title: string;
  summary: string;
  sections?: Array<{ label: string; body: string }>;
  bullets?: string[];
  highlights?: Array<{
    label: string;
    color: string;
    tokenIds: number[];
  }>;
  quiz?: {
    title: string;
    instructions?: string;
    questions: QuizQuestion[];
  };
  glossary?: GlossaryEntry[];
  images?: ImageAsset[];
  timeline?: Array<{
    title: string;
    detail?: string;
    cause?: string;
    effect?: string;
  }>;
  references?: Array<{
    sourceTokenIds: number[];
    targetTokenIds: number[];
    label?: string;
  }>;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type CostEstimate = {
  inputCostUsd?: number;
  outputCostUsd?: number;
  imageCostUsd?: number;
  totalCostUsd?: number;
  pricingLabel?: string;
};

export type RunResult = {
  id: string;
  groupId: string;
  toolId: string;
  toolName: string;
  createdAt: number;
  providerId: string;
  providerLabel: string;
  model: string;
  status: "pending" | "success" | "error";
  durationMs?: number;
  prompt: string;
  selectedText?: string;
  settings: Record<string, string | number | boolean>;
  usage?: TokenUsage;
  cost?: CostEstimate;
  imageGenerationModel?: string;
  output?: ToolOutput;
  error?: string;
};

export type RunGroup = {
  id: string;
  toolId: string;
  toolName: string;
  createdAt: number;
  prompt: string;
  selectedText?: string;
  settings: Record<string, string | number | boolean>;
  autoSelectLocked: boolean;
  runs: RunResult[];
};

export type UsageLogEntry = {
  id: string;
  createdAt: number;
  toolId: string;
  toolName: string;
  providerId: string;
  providerLabel: string;
  model: string;
  status: RunResult["status"];
  durationMs?: number;
  selectedTextLength: number;
  settings: Record<string, string | number | boolean>;
  usage?: TokenUsage;
  cost?: CostEstimate;
  imageGenerationModel?: string;
  error?: string;
};
