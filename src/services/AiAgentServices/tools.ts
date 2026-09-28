import { AiAgentTools } from "../../models/AiAgent";
import { callHttpTool, describeResult, HttpContext, httpToolDefinitions, toolNameOf } from "./httpTools";
import { ToolDefinition } from "./types";

// Actions that change the ticket run only after the agent's reply is sent,
// so the customer gets the goodbye/handoff message before the ticket moves.
export type DeferredAction =
  | { type: "transfer"; queueId: number | null; reason: string }
  | { type: "close"; reason: string };

export interface ToolContext {
  queues: { id: number; name: string }[];
  http?: HttpContext;
  /** Search of the agent's knowledge base (when it has documents to search). */
  searchKnowledge?: (query: string) => Promise<{ title: string; description: string | null; content: string }[]>;
}

export interface ToolSet {
  definitions: ToolDefinition[];
  execute: (name: string, input: unknown) => Promise<{ result: string; error?: boolean }>;
  actions: DeferredAction[];
}

const asObject = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" ? (input as Record<string, unknown>) : {};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const buildToolSet = (config: AiAgentTools = {}, ctx: ToolContext): ToolSet => {
  const actions: DeferredAction[] = [];
  const definitions: ToolDefinition[] = [];
  type Result = { result: string; error?: boolean };
  const handlers: Record<string, (input: Record<string, unknown>) => Result | Promise<Result>> = {};

  // Only one ticket-changing action per turn.
  const alreadyDecided = () =>
    actions.length > 0
      ? { result: "Já existe uma ação final (transferência ou encerramento) definida para este atendimento.", error: true }
      : null;

  if (config.transfer?.enabled) {
    const allowed = (config.transfer.queueIds || []).length
      ? ctx.queues.filter(q => config.transfer.queueIds.includes(q.id))
      : ctx.queues;
    const names = allowed.map(q => q.name);

    definitions.push({
      name: "transferir_para_atendente",
      description:
        "Transfere a conversa para um atendente humano. Use quando o cliente pedir para falar com uma pessoa, " +
        "quando você não conseguir resolver ou quando o assunto exigir uma decisão humana. " +
        "Depois de chamar, avise o cliente em uma frase curta que um atendente vai continuar.",
      parameters: {
        type: "object",
        properties: {
          ...(names.length
            ? { fila: { type: "string", enum: names, description: "Fila (setor) que deve assumir a conversa." } }
            : {}),
          motivo: { type: "string", description: "Resumo curto do que o cliente precisa, para o atendente." }
        },
        required: names.length ? ["fila", "motivo"] : ["motivo"],
        additionalProperties: false
      }
    });

    handlers.transferir_para_atendente = input => {
      const decided = alreadyDecided();
      if (decided) return decided;
      const queueName = text(input.fila);
      const queue = names.length ? allowed.find(q => q.name === queueName) : null;
      if (names.length && !queue) {
        return { result: `Fila inválida. Use uma destas: ${names.join(", ")}.`, error: true };
      }
      actions.push({ type: "transfer", queueId: queue ? queue.id : null, reason: text(input.motivo) });
      return {
        result: queue
          ? `Transferência para a fila "${queue.name}" será feita após sua resposta.`
          : "Transferência para um atendente será feita após sua resposta."
      };
    };
  }

  if (config.close?.enabled) {
    definitions.push({
      name: "encerrar_atendimento",
      description:
        "Encerra o atendimento quando a dúvida do cliente foi resolvida e ele não precisa de mais nada. " +
        "Não use se o cliente ainda tiver perguntas. Depois de chamar, despeça-se do cliente.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Resumo curto de como o atendimento foi resolvido." }
        },
        required: ["motivo"],
        additionalProperties: false
      }
    });

    handlers.encerrar_atendimento = input => {
      const decided = alreadyDecided();
      if (decided) return decided;
      actions.push({ type: "close", reason: text(input.motivo) });
      return { result: "O atendimento será encerrado após sua resposta." };
    };
  }

  if (ctx.searchKnowledge) {
    definitions.push({
      name: "buscar_base_conhecimento",
      description:
        "Busca trechos nos documentos da empresa (base de conhecimento). Use antes de responder sobre produtos, " +
        "preços, prazos, políticas ou procedimentos. A busca é por palavras: se não achar, tente de novo com " +
        "sinônimos ou termos mais gerais. Responda só com o que estiver nos trechos; se não houver, diga que não sabe.",
      parameters: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Palavras-chave do que procurar, ex.: \"prazo entrega Contagem\"." }
        },
        required: ["consulta"],
        additionalProperties: false
      }
    });
    handlers.buscar_base_conhecimento = async input => {
      const query = text(input.consulta);
      if (!query) return { result: "Informe o que procurar.", error: true };
      const hits = await ctx.searchKnowledge(query);
      if (!hits.length) {
        return {
          result: `Nada encontrado para "${query}". Tente outras palavras ou diga ao cliente que não tem essa informação.`
        };
      }
      return {
        result: hits
          .map(
            (h, i) =>
              `[${i + 1}] Documento: ${h.title}${h.description ? ` (${h.description})` : ""}\n${h.content}`
          )
          .join("\n\n")
      };
    };
  }

  const httpTools = config.http || [];
  definitions.push(...httpToolDefinitions(httpTools));
  httpTools.forEach(tool => {
    handlers[toolNameOf(tool)] = async input => {
      const response = await callHttpTool(tool, input, ctx.http || {});
      return { result: describeResult(response), error: !response.ok };
    };
  });

  const execute = async (name: string, input: unknown) => {
    const handler = handlers[name];
    if (!handler) return { result: `Ferramenta desconhecida: ${name}`, error: true };
    const data = asObject(input);
    if (data.__invalidJson !== undefined) return { result: "Parâmetros em JSON inválido.", error: true };
    return handler(data);
  };

  return { definitions, execute, actions };
};
