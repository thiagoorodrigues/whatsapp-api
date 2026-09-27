import Anthropic from "@anthropic-ai/sdk";
import { AiProvider, ToolCallRecord, TurnRequest, TurnResult, normalizeHistory } from "../types";

// Claude Haiku 4.5 predates adaptive thinking and effort.
const supportsAdaptive = (model: string) => !/haiku/.test(model);
// Server-side refusal fallbacks are offered on the top models.
const supportsFallbacks = (model: string) => /claude-(opus-5|fable)/.test(model);

const runTurn = async (req: TurnRequest): Promise<TurnResult> => {
  const client = new Anthropic({ apiKey: req.apiKey, timeout: 90_000, maxRetries: 2 });

  const messages: Anthropic.Beta.BetaMessageParam[] = normalizeHistory(req.history).map(m => ({
    role: m.role,
    content: m.text
  }));
  const tools: Anthropic.Beta.BetaTool[] = req.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema
  }));
  // Stable instructions first (cached), volatile context after the breakpoint.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
    { type: "text", text: req.systemContext }
  ];

  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < req.maxSteps; step += 1) {
    const response = await client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens || 4096,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(supportsAdaptive(req.model)
        ? {
            thinking: { type: "adaptive" as const },
            output_config: { effort: (req.effort || "medium") as "low" | "medium" | "high" }
          }
        : {}),
      ...(supportsFallbacks(req.model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as any }
        : {})
    } as any);

    inputTokens +=
      (response.usage.input_tokens || 0) +
      (response.usage.cache_read_input_tokens || 0) +
      (response.usage.cache_creation_input_tokens || 0);
    outputTokens += response.usage.output_tokens || 0;

    if (response.stop_reason === "refusal") {
      return { text: "", inputTokens, outputTokens, toolCalls, stopReason: "refusal" };
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content as any });
      continue;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use"
    );

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map(b => b.text)
        .join("\n")
        .trim();
      return { text, inputTokens, outputTokens, toolCalls, stopReason: response.stop_reason || "end_turn" };
    }

    // Keep the full assistant turn (thinking blocks included) and answer
    // every tool call in a single user message.
    messages.push({ role: "assistant", content: response.content as any });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const { result, error } = await req.executeTool(use.name, use.input);
      toolCalls.push({ name: use.name, input: use.input, result, error });
      results.push({ type: "tool_result", tool_use_id: use.id, content: result, is_error: !!error });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: "", inputTokens, outputTokens, toolCalls, stopReason: "max_steps" };
};

const listModels = async (apiKey: string) => {
  const client = new Anthropic({ apiKey, timeout: 20_000 });
  const models: { id: string; name: string }[] = [];
  for await (const model of client.models.list({ limit: 100 })) {
    models.push({ id: model.id, name: model.display_name || model.id });
  }
  return models;
};

const anthropicProvider: AiProvider = { name: "anthropic", runTurn, listModels };

export default anthropicProvider;
