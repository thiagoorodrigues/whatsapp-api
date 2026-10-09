// Provider-neutral shapes of one agent turn. Each provider adapter runs its
// own native tool loop (so provider-specific content such as Claude thinking
// blocks is passed back untouched) and reports back in these shapes.

export type AiProviderName = "anthropic" | "openai" | "gemini";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema of the tool input (type: "object").
  parameters: Record<string, unknown>;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: string;
  error?: boolean;
}

export interface TurnRequest {
  apiKey: string;
  model: string;
  effort?: string | null;
  maxTokens?: number | null;
  // Ignored by models without sampling controls (current Claude models).
  temperature?: number | null;
  // Stable instructions (cacheable) and per-request context (date, contact).
  system: string;
  systemContext: string;
  history: ChatMessage[];
  tools: ToolDefinition[];
  executeTool: (name: string, input: unknown) => Promise<{ result: string; error?: boolean }>;
  maxSteps: number;
}

export interface TurnResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ToolCallRecord[];
  stopReason: string;
}

export type EmbeddingKind = "document" | "query";

export interface EmbedRequest {
  apiKey: string;
  model: string;
  texts: string[];
  // Gemini tunes vectors for documents vs. questions; OpenAI ignores it.
  kind: EmbeddingKind;
  dimensions: number;
}

export interface AiProvider {
  name: AiProviderName;
  runTurn: (request: TurnRequest) => Promise<TurnResult>;
  listModels: (apiKey: string) => Promise<{ id: string; name: string }[]>;
  // Text embeddings (knowledge base semantic search); absent = not offered.
  embed?: (request: EmbedRequest) => Promise<number[][]>;
}

// Turns the stored history into a valid alternating conversation that starts
// with the customer (every provider requires the first turn to be the user's).
export const normalizeHistory = (history: ChatMessage[]): ChatMessage[] => {
  const merged: ChatMessage[] = [];
  history
    .filter(m => m.text && m.text.trim())
    .forEach(m => {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) {
        last.text = `${last.text}\n${m.text}`;
      } else {
        merged.push({ role: m.role, text: m.text });
      }
    });
  while (merged.length && merged[0].role !== "user") merged.shift();
  return merged;
};

export const parseToolInput = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw || "{}");
  } catch (e) {
    return { __invalidJson: raw };
  }
};
