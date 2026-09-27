import OpenAI from "openai";
import { AiProvider, ToolCallRecord, TurnRequest, TurnResult, normalizeHistory, parseToolInput } from "../types";

const runTurn = async (req: TurnRequest): Promise<TurnResult> => {
  const client = new OpenAI({ apiKey: req.apiKey, timeout: 90_000, maxRetries: 2 });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${req.system}\n\n${req.systemContext}` },
    ...normalizeHistory(req.history).map(m => ({ role: m.role, content: m.text }))
  ];
  const tools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < req.maxSteps; step += 1) {
    const response = await client.chat.completions.create({
      model: req.model,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      ...(req.temperature !== null && req.temperature !== undefined ? { temperature: req.temperature } : {})
    });
    inputTokens += response.usage?.prompt_tokens || 0;
    outputTokens += response.usage?.completion_tokens || 0;

    const choice = response.choices[0];
    const message = choice?.message;
    const calls = (message?.tool_calls || []).filter(
      (c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function"
    );

    if (!message || calls.length === 0) {
      return {
        text: (message?.content || "").trim(),
        inputTokens,
        outputTokens,
        toolCalls,
        stopReason: choice?.finish_reason || "stop"
      };
    }

    messages.push(message as OpenAI.Chat.ChatCompletionMessageParam);
    for (const call of calls) {
      const input = parseToolInput(call.function.arguments);
      const { result, error } = await req.executeTool(call.function.name, input);
      toolCalls.push({ name: call.function.name, input, result, error });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  return { text: "", inputTokens, outputTokens, toolCalls, stopReason: "max_steps" };
};

const listModels = async (apiKey: string) => {
  const client = new OpenAI({ apiKey, timeout: 20_000 });
  const models: { id: string; name: string }[] = [];
  for await (const model of client.models.list()) {
    models.push({ id: model.id, name: model.id });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
};

const openaiProvider: AiProvider = { name: "openai", runTurn, listModels };

export default openaiProvider;
