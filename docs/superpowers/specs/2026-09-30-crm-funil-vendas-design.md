# CRM — Funil de vendas (etapa 1: base)

Data: 2026-09-30 · Repos: whatsapp-api, whatsapp-app

## Objetivo

Dar ao vendedor um funil de vendas em quadro (kanban) ligado ao WhatsApp, em que ele
trabalha a oportunidade sem sair da conversa, e ao gestor a visão de onde os negócios
travam. O módulo é vendido por plano.

Sucesso nesta etapa: o vendedor abre o funil, vê seus negócios por coluna, arrasta,
abre um negócio e responde o cliente ali mesmo; o negócio sobrevive ao fechamento do
atendimento; o admin configura funis, colunas, filas com acesso e regras de criação
automática; empresas sem o recurso no plano não veem nem acessam o CRM.

## Fora desta etapa

Ficam para etapas seguintes, cada uma com spec própria:

- Tarefas e lembretes (próxima ação com data, "minhas tarefas de hoje", alerta de negócio parado).
- Relatórios (conversão por coluna, previsão de receita, desempenho por vendedor).
- Campos personalizados por funil e catálogo de produtos.
- Automações por coluna, follow-up automático e IA (resumo, preenchimento de campos).

O Quadro de atendimentos (`/quadro`, etiquetas por ticket) continua como está e separado.

## Decisões

| Tema | Decisão |
|---|---|
| Criação do negócio | Manual (conversa ou quadro) e automática por regra, desligada por padrão |
| Visibilidade | Cada funil define as filas com acesso; opção por funil "vendedor vê só os seus e os sem responsável"; admin vê tudo |
| Campos | Fixos + Observações (texto livre); sem campos personalizados nesta etapa |
| Motivos de perda | Lista por empresa editável pelo admin; empresa nova recebe Preço, Concorrente, Sem resposta, Sem interesse, Outro |
| Origem | Lista fixa: Anúncio, Instagram, Site, Indicação, WhatsApp direto, Outro |
| Construção | Tabelas novas + quadro novo com `@dnd-kit` (não reaproveita `react-trello` nem etiquetas) |
| Plano | `Plans.useCrm` (padrão false) e `Plans.crmFunnels` (limite, 0 = ilimitado) |

## Dados

Todas as tabelas têm `companyId` (FK Companies, `ON DELETE CASCADE`), `createdAt`, `updatedAt`.

**Funnels** — `name`, `color`, `position` (int), `ownDealsOnly` (bool, padrão false),
`archived` (bool, padrão false).

**FunnelStages** — `funnelId` (FK, cascade), `name`, `color`, `position`, `kind`
(`open` | `won` | `lost`), `archived`. Cada funil tem exatamente uma coluna `won` e uma
`lost`, sempre depois das `open`; o serviço garante isso (não é possível criar,
apagar ou reordenar para mudar essa regra). Funil novo nasce com Lead, Qualificação,
Proposta, Negociação (`open`), Ganho (`won`) e Perdido (`lost`).

**FunnelQueues** — `funnelId`, `queueId` (PK composta, cascade nos dois lados).
Funil sem fila fica visível só para admin.

**Deals** — `funnelId`, `stageId`, `contactId` (FK Contacts, cascade), `userId`
(responsável, FK Users, `SET NULL`, opcional), `title` (padrão: nome do contato),
`value` (DECIMAL(12,2), padrão 0), `expectedCloseDate` (DATEONLY, opcional),
`source` (enum da lista de origem, opcional), `notes` (TEXT, opcional),
`status` (`open` | `won` | `lost`), `lossReasonId` (FK LossReasons, opcional),
`lossNote` (texto, opcional), `position` (DOUBLE, ordem dentro da coluna),
`stageEnteredAt` (DATE), `closedAt` (DATE, opcional).
`status` é derivado do `kind` da coluna e gravado junto para filtrar sem join.
Índices: `(companyId, funnelId, stageId, position)`, `(companyId, contactId, status)`.

**DealEvents** — `dealId` (cascade), `userId` (opcional; nulo = sistema/regra),
`type` (`created` | `stage_changed` | `owner_changed` | `won` | `lost` | `reopened` | `edited`),
`fromValue`, `toValue` (texto; ids ou valores), `createdAt`.

**LossReasons** — `name`, `active` (bool). Semeada por migration para empresas
existentes e ao criar empresa.

**FunnelRules** — `funnelId` (cascade), `stageId` (coluna inicial, deve ser `open`),
`whatsappId` (opcional), `queueId` (opcional), `active`. Pelo menos um de
`whatsappId`/`queueId` é obrigatório.

**Plans** — `useCrm` (BOOLEAN, padrão false), `crmFunnels` (INTEGER, padrão 1; 0 = ilimitado).

## Regras de negócio

- **Posição:** mover grava `position` como o ponto médio entre os vizinhos (DOUBLE);
  quando a diferença fica abaixo de 1e-6 o serviço renumera a coluna.
- **Mudar de coluna** atualiza `stageId`, `status`, `stageEnteredAt` e grava
  `DealEvents`. Para `lost` exige `lossReasonId`; para `won`/`lost` grava `closedAt`;
  voltar para `open` limpa `closedAt`, `lossReasonId`, `lossNote` e grava `reopened`.
- **Mover entre funis** é permitido pela gaveta (escolhe funil e coluna `open`).
- **Arquivar:** funil com negócios não é apagado, só arquivado. Coluna `open` só é
  apagada ou arquivada vazia; para esvaziar, a tela oferece mover os negócios para outra coluna.
  Colunas `won`/`lost` não são apagadas nem arquivadas.
- **Limite de funis:** criar funil com `crmFunnels > 0` e total não arquivado
  `>= crmFunnels` retorna `ERR_CRM_FUNNEL_LIMIT` (403).
- **Visibilidade** (um único helper usado por todas as rotas):
  admin vê todos os funis e negócios. Usuário vê funis não arquivados com ao menos
  uma fila em comum com as suas; dentro do funil, se `ownDealsOnly`, vê só negócios
  com `userId` igual ao seu ou nulo. Negócio fora da visão responde 404.

### Criação automática

Serviço `ApplyFunnelRulesService(ticket)` chamado em dois pontos:

1. Em `ProcessInboundMessage`, depois de `FindOrCreateTicketService`, só para
   mensagem recebida (não `fromMe`) e ticket que não é grupo.
2. Em `UpdateTicketService`, quando `queueId` muda para um valor não nulo.

Para cada regra ativa da empresa que casa com o ticket (`whatsappId` e/ou `queueId`
iguais; campo nulo na regra não filtra), cria um negócio na coluna da regra **se o
contato não tiver negócio `open` naquele funil**. Responsável = `ticket.userId`
(pode ser nulo). Evento `created` com `userId` nulo. As regras ativas por empresa
ficam em cache em memória por 60 s, invalidado ao salvar regra, para não consultar o
banco a cada mensagem. Falha na regra é registrada em log e não interrompe o
processamento da mensagem.

## API

Todas com `isAuth` e `requirePlanFeature("useCrm")`. Configuração exige admin.

| Método e rota | Uso |
|---|---|
| `GET /crm/funnels` | funis visíveis ao usuário, com colunas |
| `POST/PUT /crm/funnels[/:id]` | criar/editar funil, filas e `ownDealsOnly` (admin) |
| `POST /crm/funnels/:id/archive` | arquivar/desarquivar (admin) |
| `POST/PUT/DELETE /crm/funnels/:id/stages[/:stageId]` | colunas; `PUT .../stages/order` reordena (admin) |
| `GET /crm/funnels/:id/deals?stageId&page&search&userId&source` | 50 por coluna e página; a primeira carga traz a página 1 de cada coluna mais contagem e soma por coluna |
| `POST /crm/deals` | criar negócio |
| `GET /crm/deals/:id` | negócio + histórico + ticket mais recente do contato |
| `PUT /crm/deals/:id` | editar campos |
| `PUT /crm/deals/:id/move` | `{ stageId, beforeId?, afterId?, lossReasonId?, lossNote? }` |
| `GET /crm/contacts/:contactId/deals` | negócios abertos do contato (selo no cabeçalho da conversa) |
| `GET/POST/PUT/DELETE /crm/rules[/:id]` | regras de criação automática (admin) |
| `GET/POST/PUT /crm/loss-reasons[/:id]` | motivos de perda (listar: todos; editar: admin) |

**Tempo real:** evento `company-${companyId}-deal` com `{ action: "create" | "update" | "delete", dealId, funnelId, stageId }` (só ids: o socket chega a todos os clientes, então o conteúdo vem pela API com a visibilidade aplicada)
e `company-${companyId}-funnel` para mudanças de configuração. O quadro, ao receber o
evento do funil aberto, recarrega o negócio por `GET /crm/deals/:id` (404 = saiu da
visão) ou a coluna afetada. Mensagens não lidas vêm do evento `appMessage` já
existente, pelo `contactId`.

## Telas

**Funil de vendas** (`/funil`, menu "Funil de vendas" na seção Atendimento, escondido
e bloqueado por `withPlanFeature` fora do plano). Barra: seletor de funil, busca,
filtros (responsável, origem), "+ Negócio". Colunas com título, quantidade e soma
de valores. Card: contato/título, valor, responsável, dias na coluna, não lidas.
Arrastar entre colunas e reordenar com `@dnd-kit` (mouse, toque e teclado); soltar
em Perdido abre o modal de motivo e cancela o movimento se fechado sem escolher.
Ganho e Perdido recolhidas, mostrando fechados nos últimos 30 dias. Rolagem
infinita por coluna. O movimento é otimista e desfeito com aviso se a API recusar.
Sem nenhum funil: admin vê "Criar primeiro funil" (só o nome; nasce com as colunas
padrão); usuário vê "Nenhum funil disponível para as suas filas".

**Gaveta do negócio** (direita, sobre o quadro). Aba Conversa: `MessagesList` +
`MessageInputCustom` do ticket mais recente do contato, com as mesmas regras da tela
de atendimento (ticket pendente mostra "Aceitar"); contato sem ticket mostra
"Iniciar conversa" usando o fluxo do `NewTicketModal`. Aba Dados: campos com
salvamento ao sair do campo, Ganho/Perdido/Reabrir, mover para outro funil, histórico.
Link "Abrir atendimento completo".

**Conversa do atendimento.** Botão "Criar negócio" no cabeçalho (formulário curto
com contato, responsável = usuário logado e funil padrão = primeiro visível).
Selo com a coluna e o valor quando o contato tem negócio aberto; clicar abre a gaveta.
Só aparece com `useCrm` no plano.

**Configurações do CRM** (admin): abas Funis (com editor de colunas, filas e
`ownDealsOnly`), Criação automática e Motivos de perda.

**Planos.** Item "CRM / Funil de vendas" e campo "Limite de funis (0 = ilimitado)".

## Erros

| Código | Quando |
|---|---|
| `ERR_PLAN_FEATURE_NOT_AVAILABLE` (403) | plano sem `useCrm` |
| `ERR_CRM_FUNNEL_LIMIT` (403) | limite de funis |
| `ERR_CRM_LOSS_REASON_REQUIRED` (400) | mover para Perdido sem motivo |
| `ERR_CRM_STAGE_NOT_EMPTY` (400) | apagar coluna com negócios |
| `ERR_CRM_RULE_INVALID` (400) | regra com funil arquivado, coluna que não é aberta, ou conexão/fila de outra empresa |
| `ERR_CRM_STAGE_LOCKED` (400) | apagar/arquivar/reordenar Ganho ou Perdido |
| `ERR_CRM_RULE_EMPTY` (400) | regra sem conexão e sem fila |
| `ERR_CRM_STAGE_ORDER` (400) | lista de reordenação não bate com as colunas abertas |
| `ERR_CRM_NAME_REQUIRED` (400) | nome ou título vazio |
| `ERR_CRM_INVALID_VALUE` / `ERR_CRM_INVALID_SOURCE` / `ERR_CRM_INVALID_DATE` (400) | valor negativo ou não numérico, origem fora da lista, data fora de AAAA-MM-DD |
| `ERR_NO_PERMISSION` (403) | configuração sem ser admin; vendedor com `ownDealsOnly` passando negócio para outro |
| `ERR_CRM_NOT_FOUND` (404) | funil, coluna, negócio ou motivo de outra empresa ou fora da visão do usuário |

Mensagens em português no `toastError` do frontend.

## Testes

- **Backend (jest):** helper de visibilidade (admin, fila em comum, `ownDealsOnly`,
  funil sem fila); cálculo de posição e renumeração; regras de mudança de coluna
  (motivo obrigatório, `closedAt`, reabrir); `ApplyFunnelRulesService` (casa por
  conexão/fila, não duplica com negócio aberto, ignora grupo e `fromMe`); limite de
  funis; isolamento entre empresas em todas as rotas.
- **Frontend (react-scripts test):** funções puras do quadro (aplicar evento de
  tempo real, movimento otimista e desfazer, agrupamento por coluna).
- **HM:** fluxo completo no navegador — criar funil, criar negócio pela conversa,
  arrastar, perder com motivo, reabrir, regra automática com mensagem recebida,
  plano sem `useCrm`.

## Ordem de entrega

Cada passo vai para HM e só sobe para produção com o de cima pronto:

1. Migrations, models, visibilidade, API de funis/colunas/negócios e plano (`useCrm`, `crmFunnels`).
2. Tela do Funil de vendas com arrastar e gaveta (dados + conversa).
3. "Criar negócio" e selo na conversa do atendimento.
4. Configurações do CRM (funis, colunas, filas, motivos de perda).
5. Criação automática por regra.
