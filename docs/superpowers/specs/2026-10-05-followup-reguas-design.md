# Follow-up: réguas de mensagens automáticas — núcleo + gatilho "sem resposta"

Data: 2026-10-05
Status: aprovado (revisado após leitura do código em 2026-10-05 — ver "Ajustes pós-leitura")

## Objetivo

Permitir que cada empresa configure **réguas de follow-up**: sequências de mensagens
enviadas automaticamente quando o cliente para de responder, com parada automática
quando ele responde. Esta entrega cria o **núcleo** (réguas, etapas, inscrições, motor
de envio) e o primeiro gatilho, **sem resposta do cliente**.

Sucesso = um administrador cria uma régua para uma fila, o atendente envia uma mensagem,
o cliente não responde, e as etapas saem nos horários certos (respeitando o horário de
atendimento), param quando o cliente responde e, ao final, executam as ações configuradas.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Conteúdo da etapa | Por etapa: texto fixo (com variáveis e mídia) **ou** IA; o texto fixo é a reserva se a IA falhar |
| Aplicação | Régua por conexão e/ou fila; ambos vazios = todas as conversas da empresa. Grupos nunca |
| Fim sem resposta | Ações configuráveis: fechar ticket, aplicar tag (combináveis) |
| Horário | Opção "Respeitar horário de atendimento" (padrão ligado), usando `schedules` da empresa ou fila conforme `scheduleType` |
| Contagem do tempo | Cada etapa aguarda X **após o envio anterior** (etapa 1: após a última mensagem nossa) |
| Arquitetura | Tabela de inscrições + job Bull periódico (mesmo padrão dos Agendamentos) |

## Fora de escopo (specs próprios depois)

- Gatilhos: negócio parado no CRM (`deal_stalled`), manual pela conversa (`manual`), pós-atendimento (`after_close`).
- Ação final "marcar negócio como perdido".
- Limite de follow-ups por contato/dia.

## Modelo de dados

### `FollowUpRules`
| campo | tipo | observação |
|---|---|---|
| id | serial | |
| companyId | int FK Companies, not null | |
| name | string, not null | |
| active | boolean, default true | |
| trigger | string, default `'no_reply'` | únicos valores nesta entrega: `no_reply` |
| whatsappId | int FK Whatsapps, null | null = todas as conexões |
| queueId | int FK Queues, null | null = todas as filas |
| respectBusinessHours | boolean, default true | |
| finalActions | JSONB, default `{}` | `{ closeTicket?: boolean, tagId?: number }` |
| aiAgentId | int FK AiAgents ON DELETE SET NULL, null | agente cuja chave/modelo/prompt geram as etapas em modo IA; obrigatório se alguma etapa for `ai` |
| createdAt / updatedAt | | |

**Resolução de régua** (para um ticket com `whatsappId` W e `queueId` Q, considerando só `active = true` e `trigger = 'no_reply'`), da mais para a menos específica:
1. whatsappId = W e queueId = Q
2. whatsappId null e queueId = Q
3. whatsappId = W e queueId null
4. whatsappId null e queueId null

Empate no mesmo nível: menor `id`. A tela avisa quando se cria uma régua com a mesma combinação de outra ativa.

### `FollowUpSteps`
| campo | tipo | observação |
|---|---|---|
| id | serial | |
| ruleId | int FK FollowUpRules ON DELETE CASCADE | |
| order | int, not null | começa em 1 |
| delayMinutes | int, not null, > 0 | espera após o envio anterior |
| mode | string, default `'text'` | `text` ou `ai` |
| body | text, not null | texto fixo; no modo IA é a reserva |
| mediaPath / mediaName | string, null | mídia opcional (só modo `text` e reserva) |
| aiInstruction | text, null | obrigatória quando `mode = 'ai'` |

Variáveis em `body`: as mesmas do resto do sistema, via `helpers/Mustache` (`{{firstName}}`, `{{name}}`, `{{ms}}`, `{{protocol}}`, `{{hora}}`), e o mesmo `MessageVariablesPicker` na tela.

### `FollowUpEnrollments`
| campo | tipo | observação |
|---|---|---|
| id | serial | |
| companyId | int, not null | |
| ruleId | int FK FollowUpRules ON DELETE CASCADE | |
| ticketId | int FK Tickets ON DELETE CASCADE | |
| contactId | int FK Contacts | |
| currentStep | int, not null | `order` da próxima etapa a enviar |
| nextRunAt | timestamptz, not null | já ajustado ao horário de atendimento |
| status | string | `active`, `completed`, `replied`, `cancelled`, `failed` |
| stopReason | string, null | ex.: `ticket_closed`, `queue_changed`, `manual`, `whatsapp_disconnected` |
| attempts | int, default 0 | falhas de envio da etapa atual |
| lastSentAt | timestamptz, null | |
| createdAt / updatedAt | | |

Índices:
- parcial `(nextRunAt) WHERE status = 'active'` — varredura.
- único parcial `(ticketId) WHERE status = 'active'` — no máximo uma inscrição ativa por ticket.

### `Messages`
Nova coluna `followUpEnrollmentId int null` (FK FollowUpEnrollments ON DELETE SET NULL). Identifica mensagens enviadas pela régua.

## Motor (`whatsapp-api/src/services/FollowUpServices/`)

### `ResolveFollowUpRuleService(ticket)`
Aplica a ordem de resolução acima e devolve a régua (com etapas ordenadas) ou null. Régua sem etapas = null.

### `nextBusinessSlot(date, schedules)` — função pura
Recebe a data candidata e a lista de horários no formato de `Company.schedules`/`Queue.schedules` (`{ weekdayEn, startTime "HH:mm", endTime "HH:mm" }`; `startTime` vazio/nulo = dia fechado). Devolve a própria data se estiver dentro do horário; senão, o início do próximo período válido (procura até 7 dias). Sem nenhum dia aberto → devolve a data original (não bloqueia envio). Fuso: o do processo (`TZ=America/Sao_Paulo` no Dockerfile), como na checagem existente.
`getSchedulesForTicket(ticket)` lê a configuração `scheduleType` da empresa: `company` → `Company.schedules`; `queue` → `Queue.schedules` da fila do ticket (sem fila → sem restrição); ausente/outro → sem restrição. A checagem atual de "fora de horário" está inline em `ProcessInboundMessage` e não é alterada nesta entrega.

### `onMessageSaved(message)` — chamado ao final de `CreateMessageService`
Executado sem bloquear e sem propagar erro (log apenas). Ignora mensagens importadas do histórico.
- `fromMe = false`: inscrição ativa do ticket → `status = 'replied'`.
- `fromMe = true` e **todas** as condições: `isPrivate` falso, `followUpEnrollmentId` nulo, ticket `open` ou `pending`, `isGroup` falso, sem fluxo/typebot em andamento (`flowId` nulo e `typebotStatus` falso):
  - resolve régua; se não houver, cancela inscrição ativa existente (`stopReason = 'no_rule'`) e sai;
  - se existir inscrição ativa: volta para `currentStep = 1`, `attempts = 0`, recalcula `nextRunAt` (se a régua mudou, atualiza `ruleId`);
  - senão cria inscrição com `currentStep = 1`.
  - `nextRunAt = ajuste(agora + delay da etapa 1)`.

### `onTicketUpdated(ticket, oldValues)` — chamado em `UpdateTicketService`
- Fechado → cancela (`ticket_closed`).
- Fila ou conexão mudou → cancela (`queue_changed`); se a última mensagem não privada do ticket é `fromMe`, aplica a mesma lógica de inscrição.

### Job `followUpMonitor` (fila Bull em `queues.ts`, repeat a cada 30s)
1. Em transação: `SELECT ... WHERE status='active' AND nextRunAt <= now() ORDER BY nextRunAt LIMIT 50 FOR UPDATE SKIP LOCKED`.
2. Para cada inscrição (erro de uma não interrompe as demais):
   - Revalida: ticket aberto/pendente e última mensagem não privada é `fromMe`. Se não → `cancelled` (`stale`).
   - Conexão do ticket não `CONNECTED` → `attempts++`, `nextRunAt = agora + 15 min`; com `attempts >= 3` → `failed` (`whatsapp_disconnected`).
   - Monta a mensagem (`buildStepMessage`) e envia pelo mesmo caminho do `handleSendScheduledMessage`, gravando `followUpEnrollmentId`.
   - Há próxima etapa → `currentStep++`, `attempts = 0`, `lastSentAt = agora`, `nextRunAt = ajuste(agora + delay)`.
   - Era a última → `completed` e executa `finalActions`: aplica tag (se não aplicada) e fecha o ticket via `UpdateTicketService` (status `closed`).
3. Emite `company-{id}-followup` com `{ action, enrollment }` em toda mudança.

### `buildStepMessage(step, ticket)`
- `text`: substitui variáveis em `body`; anexa mídia se houver.
- `ai`: chama `generateReply` do agente de IA com as últimas 20 mensagens não privadas e `aiInstruction` como instrução. Sem chave, erro ou mais de 30s → usa `body` com variáveis e registra o motivo em log.

## API (`whatsapp-api`)

Todas autenticadas; toda consulta filtrada por `companyId` do usuário logado (inclusive ao validar `whatsappId`, `queueId`, `tagId` e `ticketId`).

| rota | perfil | descrição |
|---|---|---|
| `GET /followup-rules` | admin | lista com contagem de etapas e taxa de resposta |
| `GET /followup-rules/:id` | admin | régua com etapas |
| `POST /followup-rules` | admin | cria régua + etapas em transação |
| `PUT /followup-rules/:id` | admin | substitui etapas em transação; inscrições ativas seguem com o novo conteúdo; se a etapa atual deixou de existir, a inscrição é concluída |
| `DELETE /followup-rules/:id` | admin | remove (cascade nas inscrições) |
| `GET /followup-rules/:id/stats` | admin | por etapa: enviados, respondidos; totais por status |
| `GET /tickets/:ticketId/followup` | usuário com acesso ao ticket | inscrição ativa (etapa, total, próximo envio) ou null |
| `DELETE /tickets/:ticketId/followup` | usuário com acesso ao ticket | cancela (`manual`) |

Validação: nome obrigatório, ≥ 1 etapa, `delayMinutes > 0`, `body` obrigatório, `aiInstruction` obrigatória no modo IA.

## Tela (`whatsapp-app`)

- Item de menu **Follow-up** (admin), ao lado de Agendamentos; rota `/followups`.
- **Lista**: nome, aplica-se a (conexão/fila ou "Todas"), nº de etapas, ativa (switch), taxa de resposta, ações editar/excluir.
- **Editor** (modal ou página): nome; conexão e fila opcionais; "Respeitar horário de atendimento"; etapas em lista vertical com "Aguardar [n] [minutos|horas|dias] após o envio anterior", seletor Texto fixo / IA, campo de texto com botões de variáveis, anexo, instrução da IA; adicionar/remover/reordenar etapas; seção "Quando terminar sem resposta" com Fechar ticket e Aplicar tag. Aviso de régua duplicada.
- **Conversa**: selo no cabeçalho "Follow-up: etapa X de Y · próximo envio {data/hora}" com botão Cancelar, atualizado pelo socket; mensagens com `followUpEnrollmentId` exibem ícone de relógio.
- Visual com os tokens WeConex existentes; textos em português.

## Testes

Unitários (jest, `whatsapp-api`):
- `nextBusinessSlot`: dentro do horário; depois do fechamento → próximo dia; sexta à noite → segunda; dia fechado; sem horário configurado.
- Resolução de régua: os quatro níveis e empate.
- Variáveis: todas, sem atendente, variável desconhecida.
- `buildStepMessage` modo IA cai na reserva quando `generateReply` falha.

Serviço:
- Mensagem nossa inscreve; segunda mensagem nossa reinicia; mensagem do cliente marca `replied`; mensagem privada e mensagem do follow-up não afetam; grupo não inscreve.
- Fechar ticket cancela; trocar fila cancela e reavalia.
- Monitor: envia e avança; última etapa conclui e executa ações; conexão desconectada reagenda e falha após 3.

Homologação: régua com etapas de 1 minuto num WhatsApp real — cliente responde no meio; cliente não responde até o fim (tag + fechamento); fora do horário de atendimento.

## Migração e deploy

- Uma migration criando as três tabelas, índices e a coluna em `Messages`.
- Deploy padrão (main → build → migrate → restart). Sem réguas cadastradas o comportamento atual não muda.

## Ajustes pós-leitura do código (2026-10-05)

1. **Quem inicia/reinicia a régua** — não é um gancho genérico em `CreateMessageService` (ele também recebe mensagens automáticas: transferência, avaliação, fora de horário, saudação, fluxo). A régua só inicia/reinicia com:
   - mensagem do atendente pela plataforma (`MessageController.store`, texto e mídia, não nota interna);
   - resposta do agente de IA (`handleAiAgentMessage` em `ProcessInboundMessage`);
   - mensagem digitada no celular (`inbound.fromMe`, fora de histórico e de grupo).
   Mensagens automáticas não iniciam nem param a régua. Mensagem do cliente (não histórico) para.
2. **Troca de fila/conexão** apenas cancela; a régua da fila nova começa na próxima mensagem do atendente/IA (evita follow-up depois do aviso automático "aguarde, já vamos te atender").
3. **Fechamento** cancela no início do ramo de fechamento de `UpdateTicketService` (antes da mensagem de avaliação/encerramento). Fechamentos que não passam por ele (avaliação, fechamento automático) são pegos pela revalidação do monitor.
4. **Modo IA** usa o agente escolhido na régua (`aiAgentId`): `getProvider(agent.provider).runTurn` sem ferramentas, prompt do agente + instrução da etapa, últimas 20 mensagens.
5. **Variáveis** são as já existentes (`helpers/Mustache`).
6. Dia com `startTime`/`endTime` vazio conta como **fechado** para o follow-up (se todos os dias estiverem vazios, não há restrição). Difere da checagem de "fora de horário" atual, que trata dia vazio como sem restrição; para follow-up o erro seguro é não enviar no fim de semana.
