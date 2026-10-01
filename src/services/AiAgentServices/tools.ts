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
  /** The conversation's deal in the CRM; absent in the test console, where CRM tools only simulate. */
  crm?: {
    register: (input: { summary: string; title?: string; value?: number | string; source?: string }) => Promise<{ ok: boolean; message: string }>;
    qualify: () => Promise<{ ok: boolean; message: string }>;
  };
}

const DEAL_SOURCES = ["ad", "instagram", "site", "referral", "whatsapp", "other"];

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

  const crm = config.crm;
  if (crm?.enabled && crm.funnelId && crm.stageId) {
    definitions.push({
      name: "registrar_negocio",
      description:
        "Registra ou atualiza no CRM o negócio deste contato, depois de entender o que ele quer. " +
        "Use quando o cliente mostrar interesse real (produto, orçamento, prazo). Chame de novo quando " +
        "souber mais: o mesmo negócio é atualizado e o resumo é acrescentado. Não avise o cliente sobre o CRM.",
      parameters: {
        type: "object",
        properties: {
          resumo: {
            type: "string",
            description: "Resumo da qualificação: o que o cliente quer, orçamento, prazo, objeções e próximos passos."
          },
          titulo: { type: "string", description: "Título curto do negócio, ex.: \"Plano anual - 2 pets\". Opcional." },
          valor: { type: "number", description: "Valor estimado em reais, se o cliente indicou. Opcional." },
          origem: {
            type: "string",
            enum: DEAL_SOURCES,
            description: "Como o cliente chegou: ad (anúncio), instagram, site, referral (indicação), whatsapp, other."
          }
        },
        required: ["resumo"],
        additionalProperties: false
      }
    });
    handlers.registrar_negocio = async input => {
      const summary = text(input.resumo);
      if (!summary) return { result: "Informe o resumo da qualificação.", error: true };
      const payload: { summary: string; title?: string; value?: number | string; source?: string } = { summary };
      if (text(input.titulo)) payload.title = text(input.titulo);
      if (input.valor !== undefined && input.valor !== null && input.valor !== "") payload.value = input.valor as number | string;
      if (text(input.origem)) payload.source = text(input.origem);
      if (!ctx.crm) return { result: `Simulação (teste): o negócio seria registrado no CRM com o resumo "${summary}".` };
      const r = await ctx.crm.register(payload);
      return r.ok ? { result: r.message } : { result: r.message, error: true };
    };

    if (crm.qualifiedStageId) {
      definitions.push({
        name: "marcar_lead_qualificado",
        description:
          "Marca no CRM o negócio deste contato como lead qualificado, quando ele confirmou interesse e tem " +
          "perfil para seguir com o time de vendas. Registre o negócio antes.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      });
      handlers.marcar_lead_qualificado = async () => {
        if (!ctx.crm) return { result: "Simulação (teste): o negócio seria movido para a coluna de qualificado." };
        const r = await ctx.crm.qualify();
        return r.ok ? { result: r.message } : { result: r.message, error: true };
      };
    }
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
