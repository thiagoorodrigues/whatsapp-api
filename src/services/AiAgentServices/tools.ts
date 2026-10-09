import { AiAgentTools } from "../../models/AiAgent";
import { AgentMediaFile, MAX_MEDIA_PER_REPLY } from "./mediaTools";
import { callHttpTool, describeResult, HttpContext, httpToolDefinitions, toolNameOf } from "./httpTools";
import { ToolDefinition } from "./types";

// Actions that change the ticket run only after the agent's reply is sent,
// so the customer gets the goodbye/handoff message before the ticket moves.
export type DeferredAction =
  | { type: "transfer"; queueId: number | null; userId: number | null; keepAgent: boolean; reason: string }
  | { type: "close"; reason: string };

export interface ToolContext {
  queues: { id: number; name: string }[];
  /** People the transfer may name (only those in the agent's destinations are used). */
  users?: { id: number; name: string }[];
  /** Names of the CRM columns the agent may move the deal to. */
  crmStages?: { id: number; name: string }[];
  http?: HttpContext;
  /** Search of the agent's knowledge base (when it has documents to search). */
  searchKnowledge?: (query: string) => Promise<{ title: string; description: string | null; content: string }[]>;
  /** The conversation's deal in the CRM; absent in the test console, where CRM tools only simulate. */
  crm?: {
    register: (input: { summary: string; title?: string; value?: number | string; source?: string }) => Promise<{ ok: boolean; message: string }>;
    move: (stageId: number) => Promise<{ ok: boolean; message: string }>;
  };
  /** Tags the agent may use; without `add` (test console) it only simulates. */
  tags?: {
    list: { id: number; name: string }[];
    add?: (tagId: number) => Promise<{ ok: boolean; message: string }>;
  };
  /** Queues a file to go after the reply; absent in the test console. */
  sendMedia?: (file: AgentMediaFile) => Promise<{ ok: boolean; message: string }>;
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
    const transfer = config.transfer;
    // Destinations: the configured ones, the older queue list, or any queue.
    const configured = (transfer.targets || []).length
      ? transfer.targets
      : (transfer.queueIds || []).map(id => ({ kind: "queue" as const, id, instructions: "" }));
    const destinations = (configured.length
      ? configured
      : ctx.queues.map(q => ({ kind: "queue" as const, id: q.id, instructions: "" }))
    )
      .map(t => {
        const found = (t.kind === "user" ? ctx.users || [] : ctx.queues).find(x => x.id === t.id);
        return found ? { ...t, label: `${t.kind === "user" ? "Atendente" : "Setor"}: ${found.name}` } : null;
      })
      .filter(Boolean) as { kind: "queue" | "user"; id: number; instructions: string; label: string }[];
    const labels = destinations.map(d => d.label);
    const guide = destinations.filter(d => d.instructions.trim()).map(d => `- ${d.label}: ${d.instructions.trim()}`);

    definitions.push({
      name: "transferir_para_atendente",
      description:
        "Transfere a conversa para um atendente humano. Use quando o cliente pedir para falar com uma pessoa, " +
        "quando você não conseguir resolver ou quando o assunto exigir uma decisão humana. " +
        "Depois de chamar, avise o cliente em uma frase curta que um atendente vai continuar." +
        (guide.length ? `\nPara onde transferir em cada caso:\n${guide.join("\n")}` : ""),
      parameters: {
        type: "object",
        properties: {
          ...(labels.length
            ? { destino: { type: "string", enum: labels, description: "Setor ou atendente que deve assumir a conversa." } }
            : {}),
          motivo: { type: "string", description: "Resumo curto do que o cliente precisa, para o atendente." }
        },
        required: labels.length ? ["destino", "motivo"] : ["motivo"],
        additionalProperties: false
      }
    });

    handlers.transferir_para_atendente = input => {
      const decided = alreadyDecided();
      if (decided) return decided;
      const target = labels.length ? destinations.find(d => d.label === text(input.destino)) : null;
      if (labels.length && !target) {
        return { result: `Destino inválido. Use um destes: ${labels.join(", ")}.`, error: true };
      }
      const toQueue = target?.kind === "queue";
      actions.push({
        type: "transfer",
        queueId: toQueue ? target.id : null,
        userId: target?.kind === "user" ? target.id : null,
        keepAgent: toQueue && !!transfer.keepAgent,
        reason: text(input.motivo)
      });
      return {
        result: target
          ? `Transferência para ${target.label} será feita após sua resposta.`
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

    // Columns the agent may move the deal to; older agents: the qualified one.
    const moves = (crm.moveStages
      ? crm.moveStages
      : crm.qualifiedStageId
      ? [{ stageId: crm.qualifiedStageId, instructions: "quando o lead estiver qualificado: confirmou interesse e tem perfil para seguir com o time de vendas" }]
      : []
    )
      .map(m => {
        const stage = (ctx.crmStages || []).find(st => st.id === m.stageId);
        return stage ? { ...m, name: stage.name } : null;
      })
      .filter(Boolean) as { stageId: number; instructions: string; name: string }[];
    if (moves.length) {
      definitions.push({
        name: "mover_negocio",
        description:
          "Move no CRM o negócio deste contato para outra etapa do funil, quando a conversa chegar nela. " +
          "Registre o negócio antes. Não avise o cliente sobre o CRM. Etapas e quando mover para cada uma:\n" +
          moves.map(m => `- ${m.name}${m.instructions.trim() ? `: ${m.instructions.trim()}` : ""}`).join("\n"),
        parameters: {
          type: "object",
          properties: { etapa: { type: "string", enum: moves.map(m => m.name), description: "Etapa do funil" } },
          required: ["etapa"],
          additionalProperties: false
        }
      });
      handlers.mover_negocio = async input => {
        const move = moves.find(m => m.name === text(input.etapa));
        if (!move) return { result: `Etapa inválida. Use uma destas: ${moves.map(m => m.name).join(", ")}.`, error: true };
        if (!ctx.crm) return { result: `Simulação (teste): o negócio seria movido para a etapa "${move.name}".` };
        const r = await ctx.crm.move(move.stageId);
        return r.ok ? { result: r.message } : { result: r.message, error: true };
      };
    }
  }

  const tagList = ctx.tags?.list || [];
  if (config.tag?.enabled && tagList.length) {
    const rules = (config.tag.instructions || "").trim();
    definitions.push({
      name: "adicionar_tag",
      description:
        "Coloca uma tag (etiqueta) neste atendimento, para a equipe organizar e filtrar as conversas. " +
        "Use quando a conversa se encaixar no significado da tag; não avise o cliente." +
        (rules ? `\nQuando usar cada tag: ${rules}` : ""),
      parameters: {
        type: "object",
        properties: { tag: { type: "string", enum: tagList.map(t => t.name), description: "Nome da tag" } },
        required: ["tag"],
        additionalProperties: false
      }
    });
    handlers.adicionar_tag = async input => {
      const tag = tagList.find(t => t.name === String(input.tag || ""));
      if (!tag) return { result: `Tag não permitida. Use uma destas: ${tagList.map(t => t.name).join(", ")}.`, error: true };
      if (!ctx.tags?.add) return { result: `Simulação (teste): a tag "${tag.name}" seria adicionada ao atendimento.` };
      const r = await ctx.tags.add(tag.id);
      return r.ok ? { result: r.message } : { result: r.message, error: true };
    };
  }

  const mediaFiles = config.media?.enabled ? config.media.files || [] : [];
  if (mediaFiles.length) {
    let sent = 0;
    definitions.push({
      name: "enviar_midia",
      description:
        "Envia ao cliente um dos arquivos da empresa (folder, tabela, vídeo...). Ele chega logo depois da sua " +
        "mensagem; diga em uma frase que está enviando. Arquivos e quando enviar cada um:\n" +
        mediaFiles.map(f => `- ${f.name}${f.description ? `: ${f.description}` : ""}`).join("\n"),
      parameters: {
        type: "object",
        properties: { arquivo: { type: "string", enum: mediaFiles.map(f => f.name), description: "Nome do arquivo" } },
        required: ["arquivo"],
        additionalProperties: false
      }
    });
    handlers.enviar_midia = async input => {
      const file = mediaFiles.find(f => f.name === String(input.arquivo || ""));
      if (!file) return { result: `Arquivo desconhecido. Use um destes: ${mediaFiles.map(f => f.name).join(", ")}.`, error: true };
      if (sent >= MAX_MEDIA_PER_REPLY) return { result: `No máximo ${MAX_MEDIA_PER_REPLY} arquivos por resposta.`, error: true };
      sent += 1;
      if (!ctx.sendMedia) return { result: `Simulação (teste): o arquivo "${file.name}" seria enviado depois da mensagem.` };
      const r = await ctx.sendMedia(file);
      return r.ok ? { result: r.message } : { result: r.message, error: true };
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
