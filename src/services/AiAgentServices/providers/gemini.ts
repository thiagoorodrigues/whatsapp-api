import { GoogleGenAI, Content } from "@google/genai";
import { AiProvider, ToolCallRecord, TurnRequest, TurnResult, normalizeHistory } from "../types";

const runTurn = async (req: TurnRequest): Promise<TurnResult> => {
  const ai = new GoogleGenAI({ apiKey: req.apiKey });

  const contents: Content[] = normalizeHistory(req.history).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }]
  }));
  const config = {
    systemInstruction: `${req.system}\n\n${req.systemContext}`,
    ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
    ...(req.temperature !== null && req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.tools.length
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map(t => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.parameters
              }))
            }
          ]
        }
      : {})
  };

  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let step = 0; step < req.maxSteps; step += 1) {
    const response = await ai.models.generateContent({ model: req.model, contents, config });
    inputTokens += response.usageMetadata?.promptTokenCount || 0;
    outputTokens += response.usageMetadata?.candidatesTokenCount || 0;

    const calls = response.functionCalls || [];
    if (calls.length === 0) {
      return {
        text: (response.text || "").trim(),
        inputTokens,
        outputTokens,
        toolCalls,
        stopReason: response.candidates?.[0]?.finishReason || "STOP"
      };
    }

    const modelTurn = response.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);
    const parts = [];
    for (const call of calls) {
      const { result, error } = await req.executeTool(call.name || "", call.args || {});
      toolCalls.push({ name: call.name || "", input: call.args || {}, result, error });
      parts.push({ functionResponse: { id: call.id, name: call.name, response: error ? { error: result } : { result } } });
    }
    contents.push({ role: "user", parts });
  }

  return { text: "", inputTokens, outputTokens, toolCalls, stopReason: "max_steps" };
};

const listModels = async (apiKey: string) => {
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list();
  const models: { id: string; name: string }[] = [];
  for await (const model of pager) {
    const id = (model.name || "").replace(/^models\//, "");
    const actions = model.supportedActions || [];
    if (id && (!actions.length || actions.includes("generateContent"))) {
      models.push({ id, name: model.displayName || id });
    }
  }
  return models;
};

const geminiProvider: AiProvider = { name: "gemini", runTurn, listModels };

export default geminiProvider;
