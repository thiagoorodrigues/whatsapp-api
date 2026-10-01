# CRM no agente de IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, escolhido pelo usuário). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao agente de IA duas ferramentas de CRM — `registrar_negocio` (cria ou atualiza o negócio do contato da conversa, acrescentando o resumo da qualificação) e `marcar_lead_qualificado` (move para a coluna de qualificado) — configuradas no editor do agente.

**Architecture:** As operações "pelo sistema" ficam em `CrmServices/AgentDealService.ts` (usuário nulo nos eventos, mesmas regras do CRM, checagem do plano), reaproveitando helpers exportados de `DealService`. `tools.ts` ganha as duas definições quando `tools.crm` está ligado; sem `ctx.crm` (console de teste) elas só simulam. `RunAiAgentService` monta o `ctx.crm` com a empresa e o contato do ticket. O editor do agente ganha o bloco "Registrar negócio no CRM".

**Tech Stack:** Node/Express + sequelize-typescript, jest; React 17 + MUI 4.

**Spec (aprovado no chat em 2026-10-01):** opção B — criar e atualizar; não marca ganho/perdido; resumo acrescentado às observações com data; negócio sem responsável; eventos "Automático"; simulação no console de teste; só funil/coluna configurados e só o contato da conversa.

## Global Constraints

- `AiAgentTools.crm = { enabled: boolean; funnelId: number | null; stageId: number | null; qualifiedStageId: number | null }`.
- Ao salvar o agente com `crm.enabled`, funil e colunas precisam ser da empresa, o funil não arquivado e as colunas `open` não arquivadas do mesmo funil → senão `ERR_AI_CRM_CONFIG` (400).
- Em execução, se o plano não tiver `useCrm` ou o funil/coluna não servirem mais, a ferramenta devolve uma mensagem de erro ao modelo (não quebra a conversa).
- Um negócio por contato por funil: se houver negócio `open` do contato no funil, atualiza; senão cria na coluna inicial, no topo.
- Resumo acrescentado: `notas anteriores + "\n\n" + "Resumo da IA (dd/mm/aaaa HH:mm): ..."` no fuso `America/Sao_Paulo`.
- Origens aceitas: `ad`, `instagram`, `site`, `referral`, `whatsapp`, `other`.
- Commits em português com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; sem push.

## Review Focus

1. **Duas chamadas de `registrar_negocio` na mesma conversa** → um negócio só, notas com os dois resumos. Teste em `AgentDealService.spec.ts`.
2. **Agente configurado com funil de outra empresa** → salvar recusa (`ERR_AI_CRM_CONFIG`). Teste em `AgentDealService.spec.ts` (`assertCrmToolConfig`).
3. **Valor inválido vindo do modelo ("muito", -10)** → ferramenta devolve erro legível, nada é gravado. Teste em `tools.spec.ts`/`AgentDealService.spec.ts`.
4. **Console de teste** → nada é criado; a nota mostra a simulação. Teste em `tools.spec.ts` + HM.
5. **Plano sem CRM depois de configurado** → ferramenta responde que o CRM não está disponível; a conversa segue. Teste em `AgentDealService.spec.ts`.

---

### Task 1: Serviço de negócios pelo agente (backend)

**Files:**
- Create: `whatsapp-api/src/services/CrmServices/AgentDealService.ts`
- Test: `whatsapp-api/src/services/CrmServices/__tests__/AgentDealService.spec.ts`
- Modify: `whatsapp-api/src/services/CrmServices/DealService.ts` (exportar `topPosition`, `loadCard`, `emitDeal`)
- Modify: `whatsapp-api/src/models/AiAgent.ts` (tipo `crm` em `AiAgentTools`)

**Interfaces:**
- Produces: `appendSummary(notes, summary, at): string`, `crmToolConfig(raw): CrmToolConfig`, `assertCrmToolConfig(companyId, cfg): Promise<void>`, `registerContactDeal(params): Promise<{ ok: boolean; message: string; created?: boolean; dealId?: number }>`, `qualifyContactDeal(params): Promise<{ ok: boolean; message: string }>`.

Implementação e testes conforme as regras acima (código no commit; a lógica pura `appendSummary`/`crmToolConfig` é testada sem mocks, e os fluxos com os models simulados).

Run: `cd whatsapp-api && npx jest src/services/CrmServices --coverage=false && npx tsc --noEmit -p .`

### Task 2: Ferramentas do agente e configuração (backend)

**Files:**
- Modify: `whatsapp-api/src/services/AiAgentServices/tools.ts` (`ToolContext.crm`, duas ferramentas)
- Modify: `whatsapp-api/src/services/AiAgentServices/generateReply.ts` (repassa `crm` ao `buildToolSet`)
- Modify: `whatsapp-api/src/services/AiAgentServices/RunAiAgentService.ts` (monta `crm` com o ticket)
- Modify: `whatsapp-api/src/services/AiAgentServices/AgentService.ts` (`clean` guarda `tools.crm`; create/update chamam `assertCrmToolConfig`)
- Test: `whatsapp-api/src/services/AiAgentServices/__tests__/tools.spec.ts`

Testes: definições só com `crm.enabled` + funil + coluna; `marcar_lead_qualificado` só com `qualifiedStageId`; sem `ctx.crm` simula; com `ctx.crm` repassa título/valor/origem/resumo; resumo vazio → erro.

### Task 3: Editor do agente (frontend)

**Files:**
- Modify: `whatsapp-app/src/pages/AiAgents/Editor.js` (bloco "Registrar negócio no CRM" em `renderTools`, só com `plan.useCrm`; carrega `/crm/funnels`)
- Modify: `whatsapp-app/src/translate/languages/pt.js` (`ERR_AI_CRM_CONFIG`)

HM: ligar no agente, escolher Vendas / Lead / Qualificação, salvar; console de teste com uma conversa de qualificação → notas "Ferramenta: registrar_negocio" e resposta, nenhum negócio criado no banco.

Depois: revisão final independente; merge/publicação só com o usuário.
