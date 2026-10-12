# Gateway whatsmeow — Plano 3: Wazzy usando o gateway (chave `WHATSAPP_ENGINE`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Wazzy passa a falar com o WhatsApp pelo gateway whatsmeow quando `WHATSAPP_ENGINE=whatsmeow` (comandos HTTP + eventos Redis Streams), mantendo o Baileys intacto quando `WHATSAPP_ENGINE=baileys` (padrão), com só um motor rodando por vez — e a virada em produção documentada.

**Architecture:** Novo pacote `src/channels/whatsmeow/` (cliente HTTP, estado/health, mídia de passagem, `WhatsmeowChannel`, envelope→`InboundMessage`, handlers por tipo de evento, consumer de Redis Streams) e `src/services/WhatsmeowServices/SessionService.ts` (ciclo de vida da conexão). Serviços comuns são extraídos do listener/monitor do Baileys para os dois motores chamarem a mesma regra. A chave entra em ~7 pontos (boot, controllers de sessão, `getChannel`, listener) — com `whatsmeow` nenhum socket Baileys é criado e `Whatsapps.session`/`BaileysKeys` nunca são tocados (para a volta atrás funcionar).

**Tech Stack:** Node 24 + TypeScript (whatsapp-api, Sequelize, Express, socket.io, Bull), `ioredis`, `axios`, Jest 27 (`npx jest <arquivo> --coverage=false`); frontend CRA (whatsapp-app).

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-10-gateway-whatsmeow-design.md` (seções "Wazzy (Node)" e "Decisão de 2026-10-11"). **Inventário campo a campo (fonte de verdade de arquivos/linhas, formatos e adaptadores):** `whatsapp-api/docs/superpowers/specs/2026-10-11-plano3-inventario.md` (citado como §). **Contrato do gateway:** `weconex-api-meow/README.md` (rotas, corpos, eventos). Ler os três antes de qualquer tarefa.

## Global Constraints

- Repo: `/Users/thiagorodrigues/Projetos/weconex/whatsapp-api`, branch `feat/wazzy-gateway` criada a partir da `main` atual (que já tem a correção do ack `e4d9fdd`). Frontend: `/Users/thiagorodrigues/Projetos/weconex/whatsapp-app`, branch `feat/wazzy-gateway`. Nunca push sem o usuário pedir (push na `main` = deploy em produção).
- `WHATSAPP_ENGINE` aceita só `baileys` (padrão) ou `whatsmeow`; qualquer outro valor → a api não sobe. Com `whatsmeow`: `GATEWAY_URL` e `GATEWAY_TOKEN` obrigatórios; `GATEWAY_MEDIA_ROOT` padrão = pasta `public` da api.
- **Motor `baileys` sem mudança de comportamento.** Toda tarefa mantém a suíte atual verde com o padrão.
- **Com `whatsmeow`, nunca:** criar socket Baileys, ler/escrever `Whatsapps.session` ou `BaileysKeys`, chamar `initWASocket`/`getWbot`.
- Regras vindas dos testes (obrigatórias): casar contato/mensagem também por LID; `helpers/mentions.ts` aceita `mentionedJid` e `mentionedJID`; ack nunca volta (já em `UpdateMessageAckService`, `CreateMessageService`); deduplicar por id (reentrega após reconexão); ler o stream em até 3 dias; mídia recebida via `POST /media` (arquivo em `.gateway/in`, apagar depois de gravar); mídia enviada gravada em `.gateway/out` e passada por `path` relativo, apagada depois; sempre enviar `mimetype`; áudio = nota de voz salvo `voice:false`.
- Consumer: grupo `wazzy-api`, um stream por conexão (`wa:events:{id}`), ordem por conexão, `XACK` só depois de gravar, `XAUTOCLAIM` para pendentes, 5 falhas → `wa:dead` + Logs do sistema (com protocolo).
- Comentários e commits em pt-BR, identificadores em inglês; commits com trailer `Co-Authored-By:` do modelo que escreveu.
- Testes: `npx jest <arquivo> --coverage=false` (o `npm test` tem pretest que migra um banco inexistente). Compilação: `npx tsc -p . --noEmit`.
- HM: Postgres `localhost:5435` (db `sweasy`), Redis `localhost:6379`, gateway `localhost:8090` (token `hm-gateway-token`, compose `wazzy-gateway-hm` no repo `weconex-api-meow`). **Antes de qualquer teste com o motor `whatsmeow`, conferir com `pgrep -fl "dist/server"` que não há backend Node órfão** (um órfão com Baileys derruba o gateway com `conflict replaced`). Nunca `--remove-orphans`; nunca parar containers `whatsapp-api-*`.

## Decisões (rulings do controlador, a partir do §0 do inventário)

1. `getChannel` sem sessão conectada no motor `whatsmeow` lança `ERR_WAPP_NOT_INITIALIZED` (mesmo contrato do Baileys), com base no registro de estado (eventos `connection` + health).
2. Boot com `whatsmeow`: `GET /sessions/{id}` para todas as conexões; `POST /connect` só para as que estavam `CONNECTED`/`OPENING`/`qrcode` **e** que o gateway conhece (pareadas); as demais ficam `DISCONNECTED` sem abrir QR.
3. `connection disconnected` com `reason`: `DISCONNECTED` + socket para o frontend; `connect_failed` → nova tentativa com backoff (`helpers/reconnectPolicy.ts`); `shutdown` → `OPENING` (o gateway restaura ao subir); `timeout` (QR não lido) → `DISCONNECTED`; `stream_replaced` → `DISCONNECTED` + Log do sistema com alerta ("outro cliente usa esta conta").
4. `logged_out`: `PENDING`, `qrcode ""`, e `POST /connect` (novo QR), como o Baileys faz hoje.
5. `message_update` (apagada para todos): paridade com hoje = só `XACK` (sem mudança no ticket).
6. Pares LID↔telefone só por eventos `lid_mapping` + fallback por `WhatsappContacts`; o Node não lê o schema `whatsmeow`.
7. Eco: no teste do HM o whatsmeow **não** devolve o que o próprio gateway envia (só recibos). Mesmo assim: `markSentByPlatform(externalId)` com o id da resposta + a checagem `Message.count` por id que já existe.
8. Arquivo que já está em `public/` (campanha, agendamento, API, flows): sempre copiar para `.gateway/out` e apagar a cópia depois (regra única, nunca apagar o original).

## Review Focus

1. **Gateway fora do ar ou lento** — envios devolvem `ERR_WAPP_NOT_INITIALIZED`/erro claro em ≤ timeout; o consumer não perde eventos (ficam no stream) e retoma sozinho. Teste nas Tasks 3, 4 e 10.
2. **Mesma mensagem entregue duas vezes** (reentrega do WhatsApp, `XAUTOCLAIM` após queda da api no meio) — um ticket/mensagem só. Teste nas Tasks 9 e 10.
3. **Evento com remetente/chat só em LID** de contato desconhecido — não cria contato duplicado; recibo/reação/presença casam pelo id/LID. Teste nas Tasks 7 e 9.
4. **Volta para `baileys`** com mensagens pendentes no stream e arquivos em `.gateway/` — nada quebra; `BaileysKeys` intacto. Teste na Task 14 (HM).
5. **Mídia grande ou ausente** (100 MB; `POST /media` → `null`) — mensagem gravada sem arquivo como hoje; arquivos de passagem sempre apagados. Teste na Task 5.

---

## Tasks

Cada tarefa abaixo segue o §6 do inventário; os arquivos, linhas e adaptadores exatos estão nas seções citadas. Toda tarefa: testes primeiro (ver falhar), implementar, `npx jest` dos arquivos tocados + `npx tsc -p . --noEmit`, commit.

### Task 1: Configuração e chave de motor
**Files:** Create `src/config/whatsappEngine.ts` (+ spec); Modify `src/server.ts` (validação na subida), `.env.example`, `package.json` (`ioredis`, `mime-types` como dependências diretas).
**Interfaces (Produces):** `engine(): "baileys" | "whatsmeow"`; `gatewayConfig(): { url: string; token: string; mediaRoot: string }` (lança se faltar com `whatsmeow`); `isWhatsmeow(): boolean`.
- [ ] Testes: padrão `baileys`; valor inválido lança; `whatsmeow` sem URL/token lança; `mediaRoot` padrão = `uploadConfig.directory`.
- [ ] Implementar; `server.ts` encerra com mensagem clara se inválido. Commit `feat: chave WHATSAPP_ENGINE e configuração do gateway`.

### Task 2: Helpers neutros (sem mudar o motor Baileys)
**Files:** §6 item 2 — `helpers/mentions.ts`, `helpers/lidLookup.ts` (novo, `lookupPhoneJidByLid` movido de `channels/baileys/toInbound.ts`), `channels/sentByPlatform.ts` (movido de `channels/baileys/`), `libs/whatsappCache.ts` (sem tipos do Baileys), `channels/index.ts` (`messageRef` com `text`), `channels/types.ts` (`kind: "baileys" | "whatsmeow"`), `helpers/SetTicketMessagesAsRead.ts` (sem `dataJson`) + specs.
- [ ] Testes: `getMentionedJids` lê as duas grafias (dataJson antigo e protojson); `messageRef` inclui `text` (= `body`); `SetTicketMessagesAsRead` funciona sem `dataJson`.
- [ ] Implementar; specs atuais do Baileys continuam verdes. Commit `refactor: helpers neutros para os dois motores`.

### Task 3: Cliente HTTP do gateway
**Files:** Create `src/channels/whatsmeow/client.ts` (+ spec).
**Interfaces:** `gatewayClient()` com um método por rota do README do gateway (mesmos nomes de campos); erros: 404 `session_not_found`/409 `not_connected` → `AppError("ERR_WAPP_NOT_INITIALIZED")`; 400 → `AppError` com a mensagem; rede/timeout → erro "gateway indisponível". Timeouts 30 s (comandos) e 120 s (`/messages`, `/media`); header `Authorization: Bearer`.
- [ ] Testes com axios simulado (corpo/rota/método de cada chamada, mapeamento de cada erro, token presente). Commit `feat: cliente HTTP do gateway whatsmeow`.

### Task 4: Registro de estado e health
**Files:** Create `src/channels/whatsmeow/state.ts` (+ spec).
**Interfaces:** `setStatus(connectionId, status)`, `isReady(connectionId): boolean`, `gatewayUp(): boolean`, `startHealthPoll()` (GET `/health` a cada 30 s; gateway fora → `isReady` falso para todas).
- [ ] Testes: transições por evento `connection`; health falho derruba `isReady`; volta do health não marca conectado sem evento. Commit `feat: estado das conexões no motor whatsmeow`.

### Task 5: Mídia de passagem
**Files:** Create `src/channels/whatsmeow/media.ts` (+ spec); Modify `channels/media.ts` (mimetype em imagem/vídeo).
**Interfaces:** `stageOutgoing(source: MediaSource, ext): Promise<{ path: string; cleanup(): Promise<void> }>` (buffer, path dentro ou fora de `public`, url); `loadIncoming(client, connectionId, rawMessage): Promise<InboundMedia | null>` (POST `/media`, lê `.gateway/in/...`, apaga, `null` quando o gateway devolve `null`).
- [ ] Testes com pasta temporária: cópia em `.gateway/out` e limpeza; original nunca apagado; `null` → `null`; erro de leitura não deixa arquivo. Commit `feat: mídia de passagem do motor whatsmeow`.

### Task 6: `WhatsmeowChannel` e `getChannel` com a chave
**Files:** Create `src/channels/whatsmeow/WhatsmeowChannel.ts` (+ spec no modelo de `channels/baileys/BaileysChannel.spec.ts`); Modify `channels/index.ts`.
**Rules:** §4 do inventário — corpo exato de cada rota; `ChatAddress`→`to`; `MessageRef`→`quoted` (colunas `messagesWhatsappsId`, `remoteJid`, `participant`, `fromMe`, `body`) e `MessageTarget`; `markRead` agrupado por (chat, sender); mídia via `stageOutgoing`; `markSentByPlatform(externalId)`; sem sessão → `ERR_WAPP_NOT_INITIALIZED`.
- [ ] Testes por método (send texto/menção/citação/encaminhada/mídia/áudio, delete, edit, react, markRead, presence, typing, watchPresence, checkNumber, profilePictureUrl, groupInfo/participants) + `getChannel` devolve o canal certo por motor. Commit `feat: WhatsmeowChannel atrás da chave de motor`.

### Task 7: Envelope `message` → `InboundMessage`
**Files:** Create `src/channels/whatsmeow/toInbound.ts` (+ spec com envelopes reais capturados no HM em 2026-10-11 — copiar os formatos do README do gateway; nada de dados de cliente).
**Rules:** §3 — `companyId` da conexão; `sender.jid` em LID → `lookupPhoneJidByLid`; `loadMedia` → `loadIncoming`; `raw` = `data.raw` (para `dataJson`); `history` respeitado.
- [ ] Testes: privado, grupo, mídia, edição, menções, LID desconhecido mantém LID. Commit `feat: tradução do envelope do gateway para InboundMessage`.

### Task 8: Serviços comuns extraídos do listener/monitor
**Files:** §6 item 8 — `services/WhatsappContactServices/ApplyLidMappingService.ts`, `services/TicketServices/MissedCallService.ts` (de `wbotMonitor.ts:42-107`), fallback LID em `ContactTypingService.handlePresenceUpdate`; `wbotMessageListener`/`wbotMonitor` passam a chamá-los + specs.
- [ ] Testes dos três serviços; specs do Baileys verdes. Commit `refactor: serviços comuns de LID, chamada perdida e digitando`.

### Task 9: Handlers por tipo de evento
**Files:** Create `src/channels/whatsmeow/handlers.ts` (+ spec).
**Rules:** §3 (tabela evento → serviço): `message` (eco, duplicidade por id, `ProcessInboundMessage`, `verifyRecentCampaign`), `receipt` (delivered/read/played → `UpdateMessageAckService`; `read_self`/`played_self` → `MarkReadOnDeviceService`; grupo por membro), `reaction` (`ReactToMessageService`, sender bruto), `message_update` (só ACK), `presence`, `lid_mapping`, `contacts`, `group_update` (`forgetGroup`), `history` (adaptador do importador, sem mudar o importador), `call` (`MissedCallService` em `terminate`, conforme a configuração `call`), `connection` (delegado à Task 11).
- [ ] Testes por tipo com serviços simulados, incluindo a mesma mensagem duas vezes (1 gravação) e recibo em LID. Commit `feat: handlers dos eventos do gateway`.

### Task 10: Consumer de Redis Streams
**Files:** Create `src/channels/whatsmeow/consumer.ts` (+ spec).
**Rules:** grupo `wazzy-api` criado com `MKSTREAM`; `XREADGROUP` dos streams das conexões ativas; fila serial por conexão; `XACK` após o handler; `XAUTOCLAIM` periódico (pendentes > 60 s); contador de tentativas → 5 falhas = `XADD wa:dead` + `XACK` + Log do sistema com protocolo; entrar/sair stream quando conexão é criada/removida; parar limpo no shutdown.
- [ ] Testes contra o Redis do HM em chaves de teste com prefixo próprio (apagar no fim), ou fake fiel: ordem por conexão, ACK só após sucesso, reprocesso após falha, `wa:dead` na 5ª, reentrega após "queda" (consumer recriado) não duplica. Commit `feat: consumer de Redis Streams do gateway`.

### Task 11: Camada de sessão e a chave nos pontos de entrada
**Files:** Create `src/services/WhatsmeowServices/SessionService.ts` (+ spec); Modify `StartWhatsAppSession.ts`, `StartAllWhatsAppsSessions.ts`, `WhatsAppSessionController.ts`, `WhatsAppController.ts`, `server.ts` (§2 e §5 do inventário).
**Rules:** `start` (POST `/connect`, status `OPENING`), `onConnection` (qr → `qrcode`+status `qrcode`+socket; connected → `CONNECTED`, `number` = `me`, presença inicial conforme `showOnline`, `SyncSessionContactsService`; disconnected/logged_out conforme decisões 3 e 4), `restart`, `logout`, `remove` (sem depender de `whatsapp.session`), `reconcileOnBoot` (decisão 2), número já em uso na mesma empresa bloqueado como hoje. Com `whatsmeow`, `StartWhatsAppSession`/boot nunca chamam `initWASocket`.
- [ ] Testes do serviço e dos controllers no motor `whatsmeow` (cliente simulado). Commit `feat: ciclo de vida da conexão pelo gateway`.

### Task 12: Monitor do servidor
**Files:** §6 item 12 — `checkServicesHealth.ts`, `alerts.ts`, `GetServerMonitorService.ts`, `whatsapp-app/src/components/ServerMonitor/index.js` (+ `format.js`).
- [ ] Linha "Gateway WhatsApp" (health, sessões conectadas, atraso do consumer e tamanho do `wa:dead`) só no motor `whatsmeow`; specs de alerts/format. Commit (nos dois repos) `feat: gateway no Monitor do servidor`.

### Task 13: Frontend (pequeno)
**Files:** `whatsapp-app/src/components/QrcodeModal/index.js:99` (fechar só pelo id da própria conexão — bug que existe hoje), `useWhatsApps/index.js` (copiar `number`).
- [ ] Build do app sem erros. Commit `fix: modal do QR só fecha com a própria conexão`.

### Task 14: HM ponta a ponta com `WHATSAPP_ENGINE=whatsmeow` (com o usuário)
Sem código novo de produto. Checklist do §6 item 14: conexão nova por QR; conexão convertida com `migrate-baileys`; texto/mídia/áudio nos dois sentidos; citação de mensagem antiga (Baileys) e nova; menções antigas e novas; apagar, editar, reagir; lida nos dois sentidos (ack não volta); digitando com `showOnline`; recibos/presença em LID; chamada recusada com aviso; histórico; eco não duplica; reentrega não duplica (derrubar a api no meio); gateway parado → `ERR_WAPP_NOT_INITIALIZED`; volta para `baileys` (gateway parado primeiro, conferir `pgrep`). Registrar no README do gateway e na memória.

### Task 15: Runbook da virada em produção (documento, com o usuário)
**Files:** Create `whatsapp-api/docs/runbooks/virada-whatsmeow.md`.
Passos: serviço `gateway` no EasyPanel (repo `weconex-api-meow`, sem domínio, volume `/app/public` da api, variáveis do `.env.example`, `GATEWAY_TOKEN` igual na api); deploy da api com o código novo e `WHATSAPP_ENGINE=baileys` (nada muda); janela de virada: parar a api, conferir que nenhum processo Node ficou, `migrate-baileys --dry-run` e gravação por conexão, subir com `WHATSAPP_ENGINE=whatsmeow`, conferir no Monitor; critérios de volta atrás e o procedimento (parar o gateway → `WHATSAPP_ENGINE=baileys` → subir a api). Sem executar nada em produção nesta tarefa.
