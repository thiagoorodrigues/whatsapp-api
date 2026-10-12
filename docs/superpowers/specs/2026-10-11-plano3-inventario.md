# Plano 3 — inventário: Baileys → gateway whatsmeow

Data: 2026-10-11

Levantamento para o Plano 3 (caminho do gateway atrás de
`WHATSAPP_ENGINE=baileys|whatsmeow`, padrão `baileys`; só um motor por vez;
com `whatsmeow` nenhum socket Baileys é criado). Contrato do gateway:
`weconex-api-meow/README.md` (API HTTP + eventos `wa:events:{connectionId}`).
Design: `2026-10-10-gateway-whatsmeow-design.md`, seção "Wazzy (Node)" e
decisão de 2026-10-11.

Convenções: caminhos relativos a `whatsapp-api/src` (ou `whatsapp-app/src`
quando indicado). `file:linha` conferido em 2026-10-11. "Sem equivalente:"
diz o que fazer quando o gateway não tem comando/evento correspondente.

---

## 0. Resumo e decisões em aberto

A regra de negócio já fala só com `MessagingChannel` (`channels/types.ts`) e
`InboundMessage` (`channels/inbound.ts`). O que é Baileys de verdade está
concentrado em: `libs/wbot.ts`, `services/WbotServices/StartWhatsAppSession.ts`,
`StartAllWhatsAppsSessions.ts`, `wbotMessageListener.ts`, `wbotMonitor.ts`,
`channels/baileys/*`, `libs/whatsappCache.ts`, `helpers/authState.ts`,
`helpers/baileysKeyStore.ts`, `models/BaileysKey.ts` e os dois controllers de
sessão. O resto passa por `getChannel`/`getTicketChannel`/`getDefaultChannel`
(`channels/index.ts:14-27`) e só precisa que `getChannel` devolva o
`WhatsmeowChannel` quando o motor for `whatsmeow`.

Decisões que o Plano 3 precisa tomar (detalhadas nas seções):

1. **Contrato de `getChannel` sem sessão**: hoje o construtor do
   `BaileysChannel` lança `ERR_WAPP_NOT_INITIALIZED` (`channels/baileys/BaileysChannel.ts:75-78`)
   e vários chamadores contam com isso (`helpers/GetWbotMessage.ts:12`,
   `queues.ts:693-695`). Proposta: o `WhatsmeowChannel` lança o mesmo erro
   quando o registro de estado (eventos `connection` + health) diz que a
   conexão não está `connected`.
2. **Quais conexões o boot conecta**: hoje `StartAllWhatsAppsSessions` sobe
   **todas** as conexões da empresa, qualquer status
   (`services/WhatsappService/ListWhatsAppsService.ts:14-31` não filtra),
   e as não pareadas abrem QR sozinhas. Com o gateway, ele mesmo restaura as
   pareadas; proposta: no boot chamar `GET /sessions/{id}` para todas,
   `POST /connect` só para as que estavam `CONNECTED`/`OPENING`/`qrcode` com
   pareamento, e marcar as demais `DISCONNECTED` sem abrir QR.
3. **`disconnected` com `reason`** (`connect_failed`, `timeout`,
   `stream_replaced`, `client_outdated`, ban, `cat_refresh_error`): a sessão
   saiu do mapa do gateway e não volta sozinha. Proposta: `DISCONNECTED` +
   socket; `connect_failed` com nova tentativa com backoff (reaproveitar
   `helpers/reconnectPolicy.ts`); `shutdown` vira `OPENING` (o gateway
   restaura sozinho ao subir); `timeout` (QR não lido) = `DISCONNECTED`,
   como os 3 QRs do Baileys (`libs/wbot.ts:327-344`).
4. **`logged_out`**: hoje o Baileys põe `PENDING`, apaga chaves e reabre QR
   em 2 s (`libs/wbot.ts:242-253`). Proposta: igual — `PENDING`/`qrcode ""` e
   `POST /connect` (o QR expira sozinho com `timeout`).
5. **`message_update` (apagada para todos)**: hoje é ignorada
   (`channels/baileys/parse.ts:215-225` descarta `protocolMessage` e o stub
   `REVOKE`; não há handler). Paridade = ignorar e só dar ACK. Opcional:
   `isDeleted=true` + `appMessage update`.
6. **Pares LID↔telefone já conhecidos no connect**: hoje vêm de
   `BaileysKeys` (`StartWhatsAppSession.ts:30-36`). Com o gateway só chegam
   por eventos `lid_mapping` (o gateway deduplica em memória por execução,
   `internal/session/manager.go:493,521`). Opcional: Node ler
   `whatsmeow.whatsmeow_lid_map` só leitura; proposta: não ler (o gateway é
   dono do schema) e depender dos eventos + fallback por `WhatsappContacts`.
7. **Eco das mensagens enviadas**: o gateway não aceita `id` no
   `POST /messages` (`internal/outgoing/build.go:38-41`), então não dá para
   marcar o id antes do envio como o Baileys faz
   (`BaileysChannel.ts:113-116`). O whatsmeow, em princípio, não recebe de
   volta o que o próprio cliente enviou (só o que sai do celular); o design
   diz que recebe. **Conferir no HM.** Defesa: `markSentByPlatform` com o
   `externalId` da resposta + checagem `Message.count` por id (já existe) e,
   para `fromMe`, uma segunda checagem depois de ~1 s se o id não existir.
8. **Arquivo já dentro de `public/`** (campanha, agendamento, API, flows):
   regra pedida = sempre copiar para `.gateway/out` e apagar depois. Otimização
   possível (o gateway aceita qualquer caminho dentro de `MEDIA_ROOT`):
   passar o relativo direto, sem copiar nem apagar. Proposta: copiar (regra
   única, sem risco de apagar o original).

---

## 1. Pontos de contato com o Baileys em `src`

Legenda da coluna "Gateway": comando HTTP (`POST /sessions/{id}/...`) ou
evento do stream (`message`, `receipt`...). "Chave" = onde a chave de motor
precisa decidir.

### 1.1 Socket e sessão (`libs/wbot.ts`)

| file:linha | O que faz | Gateway |
|---|---|---|
| `libs/wbot.ts:2-13,20` | imports de `@whiskeysockets/baileys` (`makeWASocket`, `Browsers`, `fetchLatestBaileysVersion`, `makeCacheableSignalKeyStore`, logger) | — (arquivo inteiro não é carregado com `whatsmeow`; import dinâmico ou só referenciado por `StartWhatsAppSession`) |
| `libs/wbot.ts:42` | `sessions[]` em memória (um socket por conexão) | registro de estado `channels/whatsmeow/state.ts` (status por `connectionId`) |
| `libs/wbot.ts:51-58` `getWbot` | devolve o socket ou lança `ERR_WAPP_NOT_INITIALIZED` | `state.isConnected(id)`; mesmo `AppError` |
| `libs/wbot.ts:60-78` | timer de reconexão (`scheduleReconnect` → `StartWhatsAppSession`) | sem equivalente: o whatsmeow reconecta sozinho (`disconnected` sem `reason`); só `connect_failed` pede retentativa do Node |
| `libs/wbot.ts:80-98` `removeWbot(id, isLogout)` | logout + fecha ws + tira do mapa | `isLogout=true` → `POST /logout`; `false` → nada (ou `POST /disconnect`) |
| `libs/wbot.ts:102-114` `discardWbot` | garante socket único | sem equivalente: o `connect` do gateway é idempotente |
| `libs/wbot.ts:130` | `fetchLatestBaileysVersion` | sem equivalente |
| `libs/wbot.ts:139` | `authState(whatsapp)` (creds em `Whatsapps.session`, chaves em `BaileysKeys`) | sem equivalente: chaves no schema `whatsmeow` |
| `libs/wbot.ts:144-167` | `makeWASocket` (`syncFullHistory`, `markOnlineOnConnect: showOnline` 164, `cachedGroupMetadata` 165, `getMessage` 166) | `POST /connect`; presença inicial = `POST /presence` no evento `connected` |
| `libs/wbot.ts:169-187` `getMessage` | relê `Message.dataJson` para reenvio (retry receipts) | sem equivalente: o whatsmeow guarda em memória os envios recentes; aceitável |
| `libs/wbot.ts:233-261` | `connection === "close"`: decide logout vs. reconexão (`reconnectPolicy`) | `connection` `disconnected` / `logged_out` (seção 2) |
| `libs/wbot.ts:242-253` | logout pelo WhatsApp: `status PENDING`, `session ""`, `clearBaileysKeys`, `DeleteBaileysService`, emite `whatsappSession update`, reabre em 2 s | `connection` `logged_out` → `PENDING`, `qrcode ""`, emite, `POST /connect` |
| `libs/wbot.ts:263-324` | `open`: número (`toPhoneNumber(wsocket.user.id)` 266), checagem de número em uso 270-294, `CONNECTED/qrcode ""/retries 0/number` 295-300, emite 302-305, `unavailable` se `!showOnline` 317-321 | `connection` `connected` + `me` (seção 2) |
| `libs/wbot.ts:270-294` | número já conectado em outra conexão: logout, `DISCONNECTED`, `numberInUse` | mesma regra com `POST /logout`; `isLive` de `FindNumberInUseService` vira `state.isConnected` |
| `libs/wbot.ts:326-369` | QR: até 3 → `status "qrcode"`, `qrcode`, `retries 0`, emite; no 4º → `DISCONNECTED` | `connection` `qr` (+`qr`) e `disconnected` `reason:"timeout"` |
| `libs/wbot.ts:372` | `creds.update` → `saveState` | sem equivalente |

### 1.2 Início, listener e monitor (`services/WbotServices`)

| file:linha | O que faz | Gateway |
|---|---|---|
| `StartWhatsAppSession.ts:12-44` | `status OPENING` + emite (16-22), `initWASocket` (25), `wbotMessageListener` (26), `wbotMonitor` (27), `SyncSessionContactsService` com `wbot.user` e `readKeysOfType(...,"lid-mapping")` (29-39) | **Chave**: com `whatsmeow` → `SessionService.start(whatsapp)` = emite `OPENING` + `POST /connect`; listeners não existem (o consumer é global) |
| `StartWhatsAppSession.ts:9,35` | `readKeysOfType` de `BaileysKeys` | sem equivalente (decisão 6); `me` vem do evento `connected` → `SyncSessionContactsService({me:{id: me}})` sem LID |
| `StartAllWhatsAppsSessions.ts:5-18` | sobe todas as conexões da empresa | **Chave**: com `whatsmeow` → reconciliação do boot (decisão 2) |
| `wbotMessageListener.ts:3-14` | imports Baileys, `wasSentByPlatform`, `filterMessages`, `toInbound` | — |
| `wbotMessageListener.ts:59-65` | fila serial por conexão (`queueFor`) | consumer: fila serial por conexão (reaproveitar `helpers/serialQueue.ts`) |
| `wbotMessageListener.ts:68-83` | `messages.upsert`: eco (74), duplicidade `Message.count` (75), `toInbound`, `ProcessInboundMessage`, `verifyRecentCampaign` | evento `message` (seção 3) |
| `wbotMessageListener.ts:87-98` | `messages.reaction` → `ReactToMessageService` | evento `reaction` |
| `wbotMessageListener.ts:103-113` | `lid-mapping.update` → `Contact.update({lid})` + `UpsertWhatsappContactsService` | evento `lid_mapping` |
| `wbotMessageListener.ts:117-126` | `contacts.upsert/update` → `UpsertWhatsappContactsService` | evento `contacts` |
| `wbotMessageListener.ts:129-130` | `groups.update`, `group-participants.update` → `forgetGroup` | evento `group_update` |
| `wbotMessageListener.ts:133-135` | `presence.update` → `handlePresenceUpdate` | evento `presence` |
| `wbotMessageListener.ts:137-150` | `messages.update`: ack (`UpdateMessageAckService`) e lidas no celular (`MarkReadOnDeviceService`) | evento `receipt` |
| `wbotMessageListener.ts:152-179` | `message-receipt.update` (grupo): lida por nós → `MarkReadOnDevice`; nossa → ack máximo entre membros | evento `receipt` (`read_self` / `delivered|read|played`) |
| `wbotMessageListener.ts:184-208` | importador de histórico (`createHistoryImporter`), `cancel` no close, `messaging-history.set` / `.status` | evento `history` (+ `connection` para cancelar) |
| `wbotMonitor.ts:34-109` | `CB:call` `terminate` + setting `call=disabled` → aviso automático, mensagem `call_log`, reabre ticket | evento `call` `event:"terminate"` (extrair a lógica para um serviço comum) |
| `wbotMonitor.ts:37-40` | `offer` sem ação | evento `call` `offer`: ignorar (gateway tem `POST /calls/{callId}/reject`, não usado hoje) |
| `historyImport.ts:7-10,63-67` | tipo `HistoryMessage` no formato Baileys (`key.id`, `key.remoteJid`, `messageTimestamp` em s) | adaptar o envelope (seção 3.9) ou generalizar com acessores |
| `GetProfilePicUrl.ts:3-10` | foto via `getDefaultChannel().profilePictureUrl` | `GET /avatar?jid=` (via canal) |
| `CheckNumber.ts:8-16` | `checkNumber` via canal | `POST /check` (via canal) |
| `CheckIsValidContact.ts:8-20` | idem, devolve dígitos do `jid` | `POST /check` |
| `ImportContactsService.ts:16-53` | só lê `WhatsappContacts` da conexão padrão (`getDefaultChannel` só para achar o id e exigir sessão) | nada muda além de `getChannel` |
| `SendWhatsAppMedia.ts:20-44` | converte áudio (`convertToVoiceNote`), `channel.send` com `buffer` | `POST /messages` com `path` em `.gateway/out` |
| `SendWhatsAppMessage.ts:21-55` | texto + citação (`messageRef`) + menções filtradas por `groupParticipants` | `POST /messages` (`quoted`, `mentions`), `GET /groups/{jid}` |
| `DeleteWhatsAppMessage.ts:29-33` | `GetWbotMessage` + `deleteMessage` | `DELETE /messages/{msgId}` |

### 1.3 Canal Baileys (`channels/`)

| file:linha | O que faz | Gateway |
|---|---|---|
| `channels/index.ts:5,14` | `getChannel = new BaileysChannel(id)` | **Chave**: `engine() === "whatsmeow" ? new WhatsmeowChannel(id) : new BaileysChannel(id)` |
| `channels/index.ts:43-55` `messageRef` | `{externalId, chatJid, participant, fromMe, raw}` | acrescentar `text: message.body` (citação do gateway usa `quoted.text`) |
| `channels/types.ts:81` | `kind: "baileys"` | `"baileys" \| "whatsmeow"` |
| `channels/types.ts:24-31` `MessageRef` | sem `text` | `text?: string \| null` |
| `channels/baileys/BaileysChannel.ts:33-53` | `toBaileysContent` | corpo `content` do `POST /messages` (seção 4) |
| `BaileysChannel.ts:55-58` `jidOf` | `getContactJid` | `to` = `{jid, number, lid, isGroup}` cru (gateway resolve igual) |
| `BaileysChannel.ts:61-69` `quotedOf` | citação depende de `dataJson` | `quoted` montado das colunas |
| `BaileysChannel.ts:96-108` `groupJid` | conserto de grupo antigo sem hífen | sem equivalente no Node: o gateway faz (`README` "Grupo antigo") |
| `BaileysChannel.ts:110-126` `send` | id gerado no Node + `markSentByPlatform` | `POST /messages`; marcar o `externalId` da resposta (decisão 7) |
| `BaileysChannel.ts:128-138` `deleteMessage` | `{delete: key}` | `DELETE /messages/{id}` `{chat, sender?, fromMe}` |
| `BaileysChannel.ts:140-151` `edit` | `{text, edit}` | `PUT /messages/{id}` `{chat, text}` |
| `BaileysChannel.ts:155-175` `react` | `{react: {text, key}}` | `POST /messages/{id}/reaction` `{chat, sender?, fromMe, emoji}` |
| `BaileysChannel.ts:179-195` `markRead` | `readMessages(keys)` | `POST /read` `{chat, ids, sender?}`, um por (chat, sender) |
| `BaileysChannel.ts:199-212` | aviso de recibo de leitura desligado (`fetchPrivacySettings`) | sem equivalente: remover (ou pedir rota ao gateway depois) |
| `BaileysChannel.ts:214-218` `setPresence` | `sendPresenceUpdate` | `POST /presence` `{presence}` |
| `BaileysChannel.ts:220-225` `sendTyping` | `presenceSubscribe` + `composing/recording/paused` | `POST /presence/subscribe` (se `typing`) + `POST /typing` `{chat, state}` |
| `BaileysChannel.ts:227-229` `watchPresence` | `presenceSubscribe` | `POST /presence/subscribe` `{chat}` |
| `BaileysChannel.ts:231-235` `checkNumber` | `onWhatsApp` | `POST /check` `{numbers:[digits]}` → `[{number, exists, jid?}]` |
| `BaileysChannel.ts:237-241` `profilePictureUrl` | `cachedProfilePicture` + `profilePictureUrl` | `GET /avatar?jid=` dentro de `cachedProfilePicture` (`""` = sem foto) |
| `BaileysChannel.ts:247-273` `groupInfo` | `getGroupMetadata` + monta participantes | `GET /groups/{jid}` já devolve `{subject, description, createdAt, participants:[{jid,lid?,phone?,isAdmin,isMe}]}`; converter `createdAt` em `Date` |
| `channels/baileys/toInbound.ts:1-157` | Baileys → `InboundMessage` (nome do grupo por `getGroupMetadata`, remetente com LID→telefone, `loadMedia`) | `channels/whatsmeow/toInbound.ts` (seção 3.1); `lookupPhoneJidByLid` (`toInbound.ts:32-51`) deve ser movido para um helper neutro e reaproveitado |
| `channels/baileys/parse.ts:1-286` | tipo, corpo, citação, mídia, `filterMessages`, `downloadMedia` | sem equivalente: o gateway já manda `kind`, `channelType`, `text`, `quotedId`, `editOf`, `media` |
| `channels/baileys/sentByPlatform.ts:1-32` | eco por id (TTL 10 min) | reaproveitado (é neutro) — mover para `channels/sentByPlatform.ts` |

### 1.4 Cache, chaves e histórico (`libs/`, `helpers/`, `models/`)

| file:linha | O que faz | Gateway |
|---|---|---|
| `libs/whatsappCache.ts:2` | `import type { GroupMetadata, WASocket }` | trocar por tipos neutros |
| `libs/whatsappCache.ts:15-22` `getGroupMetadata(wbot, jid)` | cache 10 min de `groupMetadata` | `cachedGroupInfo(connectionId, jid, fetch)` genérico; fetch = `GET /groups/{jid}` |
| `libs/whatsappCache.ts:25-26` `cachedGroupMetadata` | opção do `makeWASocket` | sem equivalente (cache de grupos fica no gateway para o envio) |
| `libs/whatsappCache.ts:28-30` `forgetGroup` | apaga do cache | chamado pelo evento `group_update` |
| `libs/whatsappCache.ts:36-52` `cachedProfilePicture` | foto 1 h | reaproveitado |
| `libs/historyImportProgress.ts:3,9-14` | guarda e emite `company-{id}-whatsapp` `{action:"importProgress", whatsappId, progress}` | reaproveitado |
| `helpers/authState.ts:1-39` | creds em `Whatsapps.session` + `BaileysKeys` | sem equivalente; não carregar com `whatsmeow` (Plano 4 remove) |
| `helpers/baileysKeyStore.ts` | (de)serialização de chaves | idem |
| `models/BaileysKey.ts:15-90` `clearBaileysKeys`, `readKeysOfType` | apagar/ler chaves | com `whatsmeow` nunca chamar (as chaves ficam intactas para a volta atrás) |
| `helpers/reconnectPolicy.ts:15` | backoff por status do Baileys | só para `connect_failed` (decisão 3), ou nada |
| `helpers/serialQueue.ts:17,71` | fila serial por chave | reaproveitar no consumer (não remover no Plano 4) |
| `services/BaileysServices/*`, `services/BaileysChatServices/*` | tabela legada `Baileys`; só `DeleteBaileysService` é usado (`libs/wbot.ts:247,285,332`) | sem equivalente; não chamar |
| `database/migrations/20260929100000-create-baileys-keys.ts` | tabela `BaileysKeys` | fica até a migration do Plano 4 |

### 1.5 Controllers, rotas e chamadores do canal

| file:linha | O que faz | Gateway |
|---|---|---|
| `controllers/WhatsAppSessionController.ts:8-16` `store` (`POST /whatsappsession/:id`, botão "Tentar de novo") | `StartWhatsAppSession` | **Chave**: `POST /connect` |
| `WhatsAppSessionController.ts:18-31` `update` (`PUT`, "Novo QR") | `session ""`, `clearBaileysKeys`, `StartWhatsAppSession` | **Chave**: `POST /logout` (404 ignorado) + `POST /connect`; não tocar em `session`/`BaileysKeys` |
| `WhatsAppSessionController.ts:33-46` `remove` (`DELETE`, "Desconectar") | só age `if (whatsapp.session)`; `DISCONNECTED`, apaga chaves, `getWbot().logout()` | **Chave**: a condição `whatsapp.session` não vale mais (fica vazia); `POST /logout` + `DISCONNECTED` + emite |
| `routes/whatsappSessionRoutes.ts` | as três rotas acima | sem mudança |
| `controllers/WhatsAppController.ts:104` `store` | cria conexão e `StartWhatsAppSession` | **Chave**: `SessionService.start` (+ consumer passa a ler `wa:events:{id}`) |
| `WhatsAppController.ts:177-178` `remove` | `DeleteWhatsAppService` + `removeWbot(id)` (logout) | **Chave**: `POST /logout`; consumer para de ler o stream; opcional `DEL wa:events:{id}` |
| `WhatsAppController.ts:190-191` `importProgress` | `getImportProgress` | sem mudança |
| `controllers/MessageController.ts:265,269,353` | `CheckContactNumber`, `GetProfilePicUrl` (API externa) | via canal (`POST /check`, `GET /avatar`) |
| `MessageController.ts:95` | `sendAttendantTyping` | `POST /typing` |
| `MessageController.ts:228` | `SendMessage` (API) | `POST /messages` |
| `controllers/ContactController.ts:93,132,200` | `CheckIsValidContact` | `POST /check` |
| `controllers/ImportPhoneContactsController.ts:7` | `ImportContactsService` | nada (lê `WhatsappContacts`) |
| `controllers/SessionController.ts:79`, `services/UserServices/AuthUserService.ts:58` | `ChangePresenceOnline` no logout/login | `POST /presence` |
| `services/WhatsappService/UpdateWhatsAppService.ts:161` | `ApplyPresence` ao mudar `showOnline` | `POST /presence` |
| `helpers/changePresenceOnline.ts:7-21` | presença das conexões `CONNECTED` | `POST /presence` |
| `helpers/SetTicketMessagesAsRead.ts:22,41-42` | lê `dataJson` e chama `markRead` | não selecionar `dataJson`; `POST /read` |
| `helpers/GetWbotMessage.ts:12` | exige sessão via `getTicketChannel` | contrato da decisão 1 |
| `helpers/SendMessage.ts:17,24` | envio por número (fila, agendamento, API) | `POST /messages` |
| `libs/socket.ts:73-75` | `joinChatBox` → `watchTicketPresence` | `POST /presence/subscribe` |
| `services/InboundServices/VerifyContactService.ts:34` | foto do contato a cada mensagem | `GET /avatar` (cache 1 h) |
| `services/InboundServices/ProcessInboundMessage.ts:474` | "digitando" do bot | `POST /typing` |
| `services/TypebotServices/typebotListener.ts:31-34,303,325` | digitando + mídia por `url` | `POST /typing`; `url` baixada para `.gateway/out` |
| `services/FlowServices/RunFlowService.ts:58-71` | mídia por `url` | idem |
| `services/MessageServices/SendTicketMessageService.ts:95-99` | envio genérico do ticket | `POST /messages` |
| `services/MessageServices/SendReactionService.ts:37-38` | `react` | `POST /messages/{id}/reaction` |
| `services/MessageServices/EditMessageService.ts:57-58` | `edit` | `PUT /messages/{id}` |
| `services/MessageServices/ForwardMessageService.ts:112-113` | `send` com `forwarded: true` | `POST /messages` `forwarded:true` |
| `services/TicketServices/ListGroupParticipantsService.ts:48-49` | membros (filtra `isMe`) | `GET /groups/{jid}` |
| `services/TicketServices/ShowGroupInfoService.ts:27-28` | `groupInfo` | `GET /groups/{jid}` |
| `services/TicketServices/UpdateTicketService.ts:247-344` | 5 envios de texto de troca de fila | `POST /messages` |
| `services/TicketServices/ContactTypingService.ts:20-39` | `watchPresence`, `sendTyping` | `POST /presence/subscribe`, `POST /typing` |
| `services/ContactListItemService/CreateService.ts:40`, `UpdateService.ts:29`, `services/ContactListService/ImportContacts.ts:67` | `CheckContactNumber` | `POST /check` |
| `queues.ts:93,304` | `SendMessage` (fila `MessageQueue`, `sendScheduledMessages`) | `POST /messages` |
| `queues.ts:693-695,743,746` | campanha: `getChannel`, `isReady`, `send` com arquivo de `public/` | `POST /messages`; arquivo copiado para `.gateway/out` |
| `services/MessageServices/SaveSentMessageService.ts:34` | comentário cita `channels/baileys/sentByPlatform` | atualizar |
| `services/FlowServices/RunFlowService.ts:23` | comentário cita `wbotMessageListener` | — |
| `database/migrations/20260925000400-add-number-to-whatsapps.ts:4` | comentário | — |

### 1.6 Testes que dependem do Baileys

| Arquivo | Mock | Com o gateway |
|---|---|---|
| `controllers/__tests__/WhatsAppSessionController.spec.ts:5-8` | `StartWhatsAppSession`, `clearBaileysKeys`, `libs/wbot` | casos novos para o motor `whatsmeow` (cliente HTTP simulado) |
| `helpers/__tests__/SetTicketMessagesAsRead.spec.ts:5` | `libs/wbot` | ajustar para o novo `attributes` e para o agrupamento por (chat, sender) |
| `channels/__tests__/BaileysChannel.spec.ts:2` | `libs/wbot` | modelo para `WhatsmeowChannel.spec.ts` |
| `channels/baileys/__tests__/toInbound.spec.ts:5`, `reactions.spec.ts:2` | `@whiskeysockets/baileys` | ficam (motor `baileys`); novo `whatsmeow/toInbound.spec.ts` |
| `libs/__tests__/whatsappCache.spec.ts` | socket falso | ajustar à API genérica |
| `helpers/__tests__/baileysKeyStore.spec.ts` | — | fica até o Plano 4 |
| `services/WbotServices/__tests__/historyImport.spec.ts:3-5` | mensagens no formato Baileys | casos com o adaptador do envelope |
| `libs/__tests__/historyImportProgress.spec.ts` | — | sem mudança |
| 12 specs que mocam `channels` (ProcessInboundMessage, VerifyContactService, SendWhatsAppMessage, DeleteWhatsAppMessage, ImportContactsService, SendReactionService, SaveSentMessageService, SendTicketMessageService, EditMessageService, ShowGroupInfoService, ListGroupParticipantsService, ContactTypingService) | `getChannel`/`getTicketChannel` | sem mudança (interface igual) |

---

## 2. Ciclo de vida da sessão

### 2.1 Campos e eventos que o frontend consome

`Whatsapps` (`models/Whatsapp.ts`): `status` (`OPENING`, `qrcode`,
`CONNECTED`, `DISCONNECTED`, `PENDING`; o frontend também conhece `TIMEOUT` e
`PAIRING`, `whatsapp-app/src/pages/Connections/index.js:33-40`), `qrcode`
(texto cru do QR), `retries`, `number` (dígitos, gravado no `open`),
`session` (creds do Baileys; `toJSON` remove `session` e `token`,
`models/Whatsapp.ts:188-189`), `showOnline`, `importMessages`,
`initialDate`, `finalDate`, `provider`.

Socket.io (sala `companyRoom(companyId)`):

| Evento | Payload | Quem emite | Quem consome (`whatsapp-app/src`) |
|---|---|---|---|
| `company-{id}-whatsappSession` | `{action:"update", session: <Whatsapp toJSON>}` | `StartWhatsAppSession.ts:19-22`, `libs/wbot.ts:248,286,302,333,364` | `hooks/useWhatsApps/index.js:104-107` (copia só `status`, `updatedAt`, `qrcode`, `retries`; **não copia `number`**), `components/QrcodeModal/index.js:94-101` |
| `company-{id}-whatsappSession` | `{action:"numberInUse", whatsappId, message}` | `libs/wbot.ts:287-291` | `hooks/useWhatsApps/index.js:109-111` (toast) |
| `company-{id}-whatsapp` | `{action:"update", whatsapp}` / `{action:"delete", whatsappId}` | `WhatsAppController.ts:107,153,181`, `FinishHistoryImportService.ts:18` | `hooks/useWhatsApps/index.js:89-102` |
| `company-{id}-whatsapp` | `{action:"importProgress", whatsappId, progress}` | `libs/historyImportProgress.ts:11-13` | `hooks/useWhatsApps/index.js:93-95`, `pages/Connections/index.js:233-234` |

QR no frontend: `components/QrcodeModal/index.js:2,140` usa `qrcode.react`
(`^1.0.0`) com o **texto cru** (`<QRCode value={qrCode} size={256} />`),
lido de `GET /whatsapp/{id}` (`:80-81`) e do socket (`:96`). O gateway manda
o texto cru do QR do whatsmeow no evento `connection` `qr` (formato novo
`https://wa.me/settings/linked_devices#...`); gravar em `Whatsapps.qrcode`
como hoje serve sem mudar o frontend (texto mais longo, ainda cabe em 256 px
no nível L). Observação: `QrcodeModal/index.js:99` fecha o modal em
**qualquer** `update` com `qrcode === ""`, de qualquer conexão (falta checar
`data.session.id`); com o gateway os `update` ficam mais frequentes
(`disconnected` transitório), então vale corrigir.

Botões (`pages/Connections/index.js`): "QR CODE" quando `status==="qrcode"`
(`:155-164`); "Tentar de novo" → `POST /whatsappsession/{id}` (`:69-75`) e
"Novo QR" → `PUT` (`:77-83`) quando `DISCONNECTED` (`:165-184`);
"Desconectar" → `DELETE /whatsappsession/{id}` quando
`CONNECTED|PAIRING|TIMEOUT` (`:185-198`, `:132-138`); excluir →
`DELETE /whatsapp/{id}` (`:140-146`). O frontend não muda.

### 2.2 Passo a passo hoje → gateway

| Passo | Hoje (Baileys) | Com `whatsmeow` |
|---|---|---|
| Criar conexão | `WhatsAppController.store` → `CreateWhatsAppService` (`status` padrão `OPENING`, `CreateWhatsAppService.ts:43`) → `StartWhatsAppSession` (`:104`) | igual até o `start`; `SessionService.start` = `status OPENING` + emite + consumer passa a ler `wa:events:{id}` (criar grupo `wazzy-api` com `MKSTREAM`) + `POST /connect` |
| QR | `connection.update {qr}` → `status "qrcode"`, `qrcode`, `retries 0`, emite (`wbot.ts:346-367`); depois de 3 → `DISCONNECTED`, `qrcode ""` (`:327-344`) | resposta `{state:"qr"}` e/ou evento `connection {status:"qr", qr}` (um por código; o whatsmeow troca o código ~a cada 20 s) → mesmo `update` + emite + marcar "pareando" (para a checagem de número em uso); fim do QR = `connection {status:"disconnected", reason:"timeout"}` → `DISCONNECTED`, `qrcode ""`, emite |
| Lido / conectado | `open` → número (`toPhoneNumber(user.id)`), número em uso (só se estava pareando), `CONNECTED`, `qrcode ""`, `retries 0`, `number`, emite, `unavailable` se `!showOnline`, `SyncSessionContactsService` (`wbot.ts:263-324`, `StartWhatsAppSession.ts:29-39`) | `connection {status:"connected", me:"55...:N@s.whatsapp.net"}` → `toPhoneNumber(me)`; se estava pareando e `FindNumberInUseService(whatsapp, number, state.isConnected)` achar gêmea → `POST /logout`, `DISCONNECTED`, `qrcode ""`, emite `update` + `numberInUse`; senão `CONNECTED`, `qrcode ""`, `retries 0`, `number`, emite; `POST /presence` (`available` se `showOnline`, senão `unavailable`); `SyncSessionContactsService({me:{id: me}})` |
| Queda de rede | `close` sem logout → reconexão com backoff, `status OPENING` a cada tentativa (`wbot.ts:254-260`) | `connection {status:"disconnected"}` **sem** `reason` → `OPENING` + emite (o whatsmeow reconecta sozinho); cancelar o timer ocioso do histórico |
| Sessão derrubada no gateway | — | `disconnected` com `reason` (decisão 3) |
| Gateway reiniciando | — | `disconnected` `reason:"shutdown"` → `OPENING` (volta sozinho com `connected`) |
| Logout pelo celular | `close` 401 → `PENDING`, `session ""`, `clearBaileysKeys`, `DeleteBaileysService`, emite, novo QR em 2 s (`wbot.ts:242-253`) | `connection {status:"logged_out", reason}` → `PENDING`, `qrcode ""`, emite, `POST /connect` (decisão 4); nunca tocar em `session`/`BaileysKeys` |
| "Desconectar" | `DELETE /whatsappsession` → `DISCONNECTED`, `session ""`, chaves, `wbot.logout()` (só se `session`) | `POST /logout` (404 ignorado) → `DISCONNECTED`, `qrcode ""`, emite (o `logged_out` que chega depois não deve reabrir QR: guardar "logout pedido pelo usuário") |
| "Novo QR" | `PUT /whatsappsession` → `session ""`, chaves, `StartWhatsAppSession` | `POST /logout` (ignora 404) + `start` |
| "Tentar de novo" | `POST /whatsappsession` → `StartWhatsAppSession` | `start` (`POST /connect`, idempotente) |
| Excluir conexão | `DeleteWhatsAppService` + `removeWbot(id)` (logout) | `POST /logout` (ignora 404) + parar de ler o stream; opcional `XGROUP DESTROY`/`DEL` do stream |
| Boot | `server.ts:33-44` → `StartAllWhatsAppsSessions` por empresa (todas as conexões) → depois `startQueueProcess` | reconciliação (decisão 2): `GET /health`; por conexão `GET /sessions/{id}` → `connected` = `CONNECTED` (+ `number` de `me`), `qr/connecting` = deixa os eventos atualizarem, 404 = `POST /connect` se estava pareada, senão `DISCONNECTED`; iniciar o consumer **antes** dos `connect` (para não perder o `qr`) |
| Health | — | `GET /health` a cada 30 s; falha → todas as conexões `isReady()=false` (sem mexer no `status` do banco) e linha no Monitor |

Pareamento por código (`POST /pair-phone`, evento `pair_code`): fora do
escopo da tela; o handler de `connection` deve aceitar `pair_code` e só
registrar.

---

## 3. Pipeline de entrada (stream → serviços)

### 3.0 Consumer

- Um consumer group `wazzy-api` por stream `wa:events:{connectionId}`;
  nome do consumidor = hostname. Leitura com `XREADGROUP ... BLOCK ...
  STREAMS wa:events:1 ... >` numa conexão ioredis só para isso (bloqueante);
  ao subir, ler antes os pendentes (`0`) do próprio consumidor.
- Lista de streams = todas as `Whatsapps` (todas as empresas); conexão nova
  entra no `start`, conexão excluída sai no `remove`.
- Processamento **em série por conexão** (`queueFor(connectionId)` de
  `helpers/serialQueue.ts`), `XACK` só depois do handler terminar.
- Falha → fica pendente; `XAUTOCLAIM` periódico (ex.: `min-idle` 60 s);
  `XPENDING` dá o contador de entregas; na 5ª vai para `wa:dead` (entrada
  com `stream`, `id`, `e`, erro) + `recordLog` (`libs/systemLog.ts:114`) com
  protocolo (`newProtocol`, `:34`), e `XACK`.
- Retenção de 3 dias (o gateway apaga com `MINID ~`): o consumer tem de
  rodar sempre que a api roda; expor o atraso (`XINFO GROUPS` `lag`/`pending`)
  no Monitor e alertar acima de, por exemplo, 1 hora.
- Redelivery: o WhatsApp reentrega o que o gateway não confirmou e o Redis
  reentrega o que o Node não confirmou → todo handler precisa ser
  idempotente (seção 3.1 e tabela).
- `ioredis` hoje é só dependência transitiva (vem do `bull`,
  `libs/cache.ts:1`); declarar no `package.json`. Usar `REDIS_URI`
  (`config/redis.ts:1`), o mesmo Redis em que o gateway publica.

### 3.1 `message` → `ProcessInboundMessage`

Hoje (`wbotMessageListener.ts:72-82`): eco → duplicidade → `toInbound` →
`ProcessInboundMessage(inbound)` → `verifyRecentCampaign(inbound)`.

Envelope (`internal/events/envelope.go:54-71`):
`{id, fromMe, history, timestamp(ms), chat:{jid,isGroup,name?},
sender:{jid,name?,lid?}, kind, channelType, text, hasMedia,
media?:{mimetype,fileName}, quotedId?, editOf?, forwarded, mentions, raw}`.
`raw` = `{key:{id, remoteJid, fromMe, participant?}, message:<protojson>,
pushName?, messageTimestamp(s)}` (`internal/translate/raw.go:11-37`;
`participant` só em grupo e não `fromMe`).

Montagem do `InboundMessage` (`channels/inbound.ts:23-78`):

| `InboundMessage` | Origem | Observação |
|---|---|---|
| `connectionId` | `envelope.connectionId` | |
| `companyId` | `Whatsapps.companyId` (cache por conexão) | o gateway não sabe de empresa |
| `externalId` | `data.id` | |
| `fromMe` | `data.fromMe` | |
| `history` | `false` (ao vivo) / `true` (histórico) | |
| `timestamp` | `data.timestamp` | já em ms |
| `chat` | `data.chat` | `name` vazio quando o gateway não conseguiu buscar |
| `sender.jid` | `data.sender.jid`; **se for `@lid`**, passar por `lookupPhoneJidByLid(toUserLid(jid), companyId)` (`channels/baileys/toInbound.ts:32-51`) e usar o telefone quando achar | o gateway só põe telefone quando conhece; sem isto o mesmo contato vira dois |
| `sender.name` | `data.sender.name` | em privado `fromMe` o gateway já põe os dígitos (como `toInbound.ts:81`) |
| `sender.lid` | `data.sender.lid` | |
| `kind`, `channelType`, `text`, `hasMedia` | iguais | nomes de `channelType` iguais aos do Baileys (`internal/translate/body.go:85-132`); edição = `editedMessage` |
| `loadMedia` | se `hasMedia`: `POST /media {message: raw.message}` → `{path, mimetype, fileName}` ou `null`; ler `MEDIA_ROOT/path`; devolver `{data, mimetype, fileName}`; apagar o arquivo no `finally` | só é chamado quando a mensagem vai ser gravada (`SaveInboundMessageService.ts:34-44`); timeout 120 s |
| `quotedExternalId` | `data.quotedId` | |
| `forwarded` | `data.forwarded` | |
| `editOf` | `data.editOf` | |
| `mentions` | `data.mentions` | |
| `raw` | `data.raw` (objeto) | vira `Message.dataJson` |

Diferenças que afetam serviços:
- `SaveInboundMessageService.ts:85` usa `raw.status` para o ack de mensagens
  recebidas; o `raw` do gateway não tem `status` → ack 0 (igual ao histórico
  hoje). Aceitável.
- `SaveInboundMessageService.ts:88` usa `raw.key.participant` → existe no
  `raw` do gateway (grupo, não `fromMe`).
- `helpers/mentions.ts:13-14` lê `contextInfo.mentionedJid`; o protojson do
  gateway grava `mentionedJID` → aceitar as duas grafias (usado por
  `ResolveMentionsService.ts:23` e, por ele, `BackfillMentionPreviewsService`).
- Webhook (`services/QueueIntegrationServices/webhook.ts:91`) manda `raw` no
  formato novo; nenhum cliente usa n8n (decisão do design).

Eco e duplicidade, nesta ordem, na fila da conexão:
1. `fromMe && wasSentByPlatform(connectionId, id)` → ACK e sai.
2. `Message.count({messagesWhatsappsId: id, whatsappId})` > 0 → ACK e sai
   (cobre a reentrega do WhatsApp e do Redis).
3. `ProcessInboundMessage(inbound)` e `verifyRecentCampaign(inbound)`.

### 3.2 Demais eventos

| `type` (`data`) | Serviço de hoje | Entrada que o serviço espera | Adaptador |
|---|---|---|---|
| `receipt` `{ids, chat, sender, isGroup, status}` | `UpdateMessageAckService(externalId, ack, whatsappId)` (`services/MessageServices/UpdateMessageAckService.ts:12-35`, nunca volta o ack desde e4d9fdd, `:25`) e `MarkReadOnDeviceService(externalIds, companyId, whatsappId)` (`MarkReadOnDeviceService.ts:14-55`) | id + ack numérico; ids lidos | `delivered`→3, `read`→4, `played`→5: `UpdateMessageAckService(id, ack, connId)` para cada id (casa por `messagesWhatsappsId`+`whatsappId`, então `chat`/`sender` em LID não atrapalham); `read_self`/`played_self` → `MarkReadOnDeviceService(ids, companyId, connId)`. Substitui também a lógica de grupo de `wbotMessageListener.ts:152-179` (o ack máximo já é garantido pelo serviço). Idempotente |
| `reaction` `{id, chat, sender, fromMe, emoji, at}` | `ReactToMessageService({companyId, whatsappId, externalId, jid, fromMe, emoji, at})` (`ReactToMessageService.ts:39-54`) | `jid` = "me" ou endereço cru de quem reagiu | direto: `externalId=id`, `jid=sender` (o gateway já manda `"me"` e o endereço cru, `internal/translate/message.go:115-124`), `at` (0 → `Date.now()`). Mesma fila das mensagens. Atenção: `sender` pode vir em LID e uma reação antiga da mesma pessoa gravada com telefone não é substituída (duplica o emoji dessa pessoa); opcional normalizar por `toUserLid`/telefone |
| `message_update` `{id, chat, revoked}` | nenhum (decisão 5) | — | ACK; opcional `Message.update({isDeleted:true})` + `appMessage update` |
| `presence` `{chat, sender, state}` | `handlePresenceUpdate(companyId, whatsappId, {id, presences})` (`ContactTypingService.ts:46-71`) | `id` = JID do chat; `presences[id].lastKnownPresence` | `{id: chat, presences: {[chat]: {lastKnownPresence: state}}}` (`paused` → `typingState` dá `null`, para o "digitando"). O serviço já procura por `Contact.lid` quando o id é `@lid` (`:55-60`); **o gateway manda em LID** → acrescentar fallback: sem contato pelo LID, procurar `WhatsappContacts` (`whatsappId`, `lid`) → `number` → `Contact` por número (ou `lookupPhoneJidByLid`). Só chega depois de `POST /presence available` + `POST /presence/subscribe` (seção 4) |
| `lid_mapping` `{lid, pn}` | handler inline `wbotMessageListener.ts:103-113` | `pn`, `lid` | extrair para `services/WhatsappContactServices/ApplyLidMappingService.ts` (`toPhoneNumber(pn)`, `toUserLid(lid)`, `Contact.update({lid}, {where:{number, companyId}})`, `UpsertWhatsappContactsService([{id: "<num>@s.whatsapp.net", lid}])`) e usar nos dois motores. Também chega antes do `history` (pares do histórico) |
| `contacts` `{contacts:[{jid, lid?, name?, notify?}]}` | `UpsertWhatsappContactsService({whatsappId, companyId, contacts: SyncedContact[]})` (`UpsertWhatsappContactsService.ts:46-87`) | `SyncedContact {id, lid?, phoneNumber?, name?, notify?, verifiedName?}` | `{id: jid, lid, name, notify}`; `jid` pode ser LID quando o telefone é desconhecido (`internal/translate/other.go:69-86`) e o serviço já trata (`:29-39`) |
| `group_update` `{jid}` | `forgetGroup(connectionId, jid)` (`libs/whatsappCache.ts:28-30`) | — | direto |
| `history` `{messages, contacts, progress, final}` | `createHistoryImporter` (`historyImport.ts:71-211`) via `wbotMessageListener.ts:184-208` | lotes de mensagens no formato Baileys + `prepare` (contatos) + `progress` | ver 3.3 |
| `call` `{event, callId, from, isVideo, isGroup, ts}` | lógica de `wbotMonitor.ts:42-107` | `from` (LID ou telefone), `call-id` | extrair para `services/WbotServices/MissedCallService.ts` `({companyId, whatsappId, from, callId})` usado pelos dois motores; `event:"terminate"` chama; `offer` ignora. `from` em LID: hoje busca `Contact.lid` (`wbotMonitor.ts:53-56`); acrescentar o mesmo fallback LID→telefone da presença. `isGroup` true → ignorar (chamada de grupo) |
| `connection` `{status, qr?, code?, me?, reason?}` | `libs/wbot.ts:221-371` (status + socket do frontend) | — | `SessionService.onConnection` (seção 2.2); também `history.cancel()` em `disconnected`/`logged_out` |

### 3.3 Histórico

`createHistoryImporter<M>` usa de cada mensagem `key.id`, `key.remoteJid` e
`messageTimestamp` em segundos (`historyImport.ts:7-10,63-67,137-150`). O
gateway manda `history.messages` como envelopes `message` com
`history: true`, em lotes de até 200 (`HistoryChunk`,
`internal/translate/other.go:106-139`); os contatos (push names) vêm só no
primeiro lote; `progress` é o mesmo em todos os lotes de um sync; `final`
vai só no último lote do sync e pode ser impreciso.

Adaptador (sem mudar o importador):
`M = {key:{id, remoteJid: chat.jid}, messageTimestamp: Math.floor(timestamp/1000), env}`.
- `load` = `ShowWhatsAppService` (igual a `wbotMessageListener.ts:185-192`);
- `exists` = `Message.count` por id + conexão;
- `handle` = monta o `InboundMessage` de `m.env` com `history: true` →
  `ProcessInboundMessage` (`loadMedia` só para as gravadas);
- `finish` = `FinishHistoryImportService`; `report` = `publishImportProgress`;
- `onBatch(messages, () => upsertContacts(contacts), progress)`;
- `final === true` → `receivedAll()` (só ajusta o percentual; o fim continua
  sendo a fila vazia + `idleMs`, que tolera o `final` impreciso);
- um importador por conexão, mantido no consumer; `cancel()` no
  `disconnected`/`logged_out`.

O handler do evento `history` só enfileira (`onBatch` volta na hora): o lote
roda na fila própria do importador e o `XACK` sai logo. Se a api cair no meio
de um lote, o que não foi gravado se perde (igual a hoje: o WhatsApp não
reenvia histórico). Aceitável; anotar.

---

## 4. Saída (`MessagingChannel` → HTTP)

Cliente HTTP: axios (`package.json` já tem), `baseURL = GATEWAY_URL`,
`Authorization: Bearer ${GATEWAY_TOKEN}`, timeout 30 s nos comandos e 120 s
em `POST /messages` com mídia e `POST /media` (iguais aos do gateway,
`internal/httpapi/router.go:95`). Envelope `{success, data, error}`; erros:
409 `not_connected` e 404 `session_not_found` → `AppError("ERR_WAPP_NOT_INITIALIZED")`;
400 → erro do chamador; 500/rede → erro genérico (cada serviço já converte
para o seu `ERR_*`).

Endereços:
- `ChatAddress` → `to` = `{jid?, number?, lid?, isGroup?}` sem conversão
  (`outgoing.Address`; mesma ordem de `getContactJid`,
  `helpers/GetPhoneJid.ts:64-72`; grupo antigo sem hífen resolvido no gateway).
  Para os comandos que pedem `chat` (string): `message.remoteJid ||
  getContactJid({number, lid}, isGroup)`.
- `MessageRef` → alvo `{chat, sender?, fromMe}`: `chat = chatJid ||
  jidOf(to)`; `sender = participant` só em grupo e `!fromMe`;
  `fromMe = !!fromMe`. Colunas: `Message.messagesWhatsappsId`, `remoteJid`,
  `participant`, `fromMe`, `body`. Não ler mais `dataJson`.
- `quoted` = `{id: externalId, chat, sender: participant (grupo, !fromMe),
  fromMe, text: body}` (precisa de `messageRef` com `text`). Vale para
  mensagens antigas no formato Baileys.

| Método (`channels/types.ts`) | HTTP | Corpo / observações |
|---|---|---|
| `isReady()` | — | `state.isConnected(connectionId) && state.gatewayUp` |
| `send(to, content, {quoted, forwarded})` | `POST /sessions/{id}/messages` | `{to, content:{type, text?, mentions?, caption?, fileName?, mimetype, voice?, path?}, quoted?, forwarded?}` → `{externalId, chatJid, raw}` = `SentMessage` direto; `markSentByPlatform(connId, externalId)` ao receber; mídia: ver abaixo |
| `deleteMessage(chat, ref)` | `DELETE /sessions/{id}/messages/{externalId}` | `{chat, sender?, fromMe}` |
| `edit(chat, ref, text)` | `PUT /sessions/{id}/messages/{externalId}` | `{chat, text}` |
| `react(chat, ref, emoji)` | `POST /sessions/{id}/messages/{externalId}/reaction` | `{chat, sender?, fromMe, emoji}` (`""` remove) |
| `markRead(chat, refs)` | `POST /sessions/{id}/read` | filtrar `fromMe !== true`; agrupar por (`chatJid`, `participant`); um POST por grupo `{chat, ids, sender?}` (`sender` obrigatório em grupo) |
| `setPresence(p)` | `POST /sessions/{id}/presence` | `{presence: "available" \| "unavailable"}` |
| `sendTyping(chat, typing)` | `POST /sessions/{id}/presence/subscribe` (se `typing`) + `POST /sessions/{id}/typing` | `{chat, state}`; `true`→`composing`, `"recording"`→`recording`, `false`→`paused` |
| `watchPresence(chat)` | `POST /sessions/{id}/presence/subscribe` | `{chat}` |
| `checkNumber(n)` | `POST /sessions/{id}/check` | `{numbers:[digits]}` → `[0]` → `{exists, jid}` |
| `profilePictureUrl(chat)` | `GET /sessions/{id}/avatar?jid=<encodeURIComponent>` | `{url}`; dentro de `cachedProfilePicture`; `""` → `null` |
| `groupInfo(chat)` / `groupParticipants` | `GET /sessions/{id}/groups/{encodeURIComponent(jid)}` | `createdAt` string/null → `Date`/`null`; cache 10 min por conexão; `forgetGroup` no `group_update` |

Mídia de saída (`MediaSource` = `buffer | path | url`,
`channels/types.ts:14`):
1. destino `MEDIA_ROOT/.gateway/out/<uuid><ext>`, com
   `MEDIA_ROOT = uploadConfig.directory` (`config/upload.ts:5`; HM =
   `whatsapp-api/public`, produção = volume `/app/public` comum com o
   gateway); permitir sobrescrever por `GATEWAY_MEDIA_ROOT`;
2. `buffer` → grava; `path` → copia (decisão 8); `url` → baixa (typebot,
   flows);
3. `content.path = ".gateway/out/<arquivo>"` (relativo, sem `/` inicial);
4. apaga no `finally` (o gateway também limpa depois de 24 h).

`mimetype` sempre: `audio` já tem (`audio/mp4` vindo de
`convertToVoiceNote`, `channels/media.ts:10,27`); `document` já tem; para
`image`/`video` `contentFromUpload`/`contentFromFile` não guardam o tipo →
acrescentar `mimetype` ao `OutgoingContent` de imagem/vídeo ou calcular com
`mime-types` pela extensão (`mime-types` também é só transitiva hoje;
declarar). Áudio: o gateway manda como nota de voz salvo `voice:false`;
passar `voice: content.voice !== false` (flows mandam `voice:false`,
`RunFlowService.ts:60`). Nota de voz em `audio/mp4` funcionava no Baileys;
**conferir no HM** que o whatsmeow mostra como nota de voz (o padrão dele sem
mimetype é `audio/ogg; codecs=opus`).

---

## 5. Demais pontos que precisam de decisão

| Ponto | Onde | Proposta |
|---|---|---|
| `Whatsapps.session` | `authState.ts:12,23`; `WhatsAppSessionController.ts:25,38-39`; `ListWhatsAppsService.ts:27-29`; `models/Whatsapp.ts:43,188` | com `whatsmeow`: nunca ler nem escrever (a volta atrás depende dela intacta); `remove` deixa de depender de `session` |
| `BaileysKeys` | `models/BaileysKey.ts:80,84`; chamadas em `wbot.ts:246,284`, `WhatsAppSessionController.ts:26,40`, `authState.ts:17` | nunca chamar com `whatsmeow` |
| Número / "eu" (`wbot.user`) | `wbot.ts:266`; `toInbound.ts:87` (remetente `fromMe` em grupo); `BaileysChannel.ts:251-252` (`isMe`) | `me` do evento `connected`; `isMe` já vem do gateway; remetente `fromMe` de grupo vem no envelope (`r.Me()`); LID próprio indisponível (só se o gateway passar a mandar) |
| Cache de grupos | `libs/whatsappCache.ts` | API genérica por conexão; o gateway tem cache próprio para nome (10 min) e lista de grupos (10 min) |
| Fotos | `libs/whatsappCache.ts:36-52`, `VerifyContactService.ts:34` | `GET /avatar` dentro do mesmo cache; a cada mensagem nova com cache vazio sai uma chamada (igual a hoje) |
| Importar contatos | `ImportContactsService.ts` | sem mudança (depende de `contacts`/`history.contacts` terem alimentado `WhatsappContacts`) |
| Checar número | `CheckNumber.ts`, `CheckIsValidContact.ts` + 6 chamadores | via canal |
| Filas Bull que enviam | `queues.ts:81-93` (`MessageQueue`), `:290-310` (agendadas), `:681-760` (campanha) | não falam com o Baileys direto; só passam por `getChannel` e `SendMessage`. Atenção: campanha confere `isReady()` (`:695`) e `getChannel` lança sem sessão |
| `FindNumberInUseService` `isLive` | `services/WhatsappService/FindNumberInUseService.ts:13,21`; chamado em `wbot.ts:272` | `id => state.isConnected(id)` |
| Monitor do servidor | `services/ServerMonitorServices/checkServicesHealth.ts:56-89` (`ServicesHealth` em `alerts.ts:30-34`), `listConnectionsStatus.ts:7-24` (lê `Whatsapps.status`), `alerts.ts:95-97`; frontend `whatsapp-app/src/components/ServerMonitor/index.js:234-260` | `ServicesHealth.gateway?: Check & {connected, sessions}` (de `GET /health`) e `stream?: {lag, pending, dead}`; alerta quando o gateway cai ou o atraso passa do limite; `listConnectionsStatus` continua no `status` do banco (mantido pelos eventos) |
| Variáveis | `.env.example`, `server.ts:16-20`, `Dockerfile` (sem mudança) | `WHATSAPP_ENGINE` (padrão `baileys`), `GATEWAY_URL` (prod `http://wazzy_gateway:8080`, HM `http://localhost:8090`), `GATEWAY_TOKEN` (HM `hm-gateway-token`), opcional `GATEWAY_MEDIA_ROOT`; `REDIS_URI` já existe. Com `whatsmeow` sem `GATEWAY_URL`/`GATEWAY_TOKEN` → sair no boot como `JWT_SECRET` |
| Volume de mídia | design "Riscos" | api e gateway como root no mesmo volume; `.gateway/` não é servido pelo Express (começa com ponto) |
| Import do pacote Baileys | `libs/wbot.ts`, `wbotMessageListener.ts`, `wbotMonitor.ts`, `channels/baileys/*`, `authState.ts`, `whatsappCache.ts` (só tipo) | com `whatsmeow` o pacote ainda é carregado se esses módulos forem importados estaticamente por `channels/index.ts`, controllers e `StartWhatsAppSession`. Aceitável no Plano 3 (carregar não abre socket); preferir `require` tardio dentro do ramo `baileys` para garantir que nada do Baileys roda |
| Pontos da chave de motor | — | `server.ts:33-44` (boot + consumer), `StartWhatsAppSession.ts:12`, `StartAllWhatsAppsSessions.ts:5`, `WhatsAppSessionController.ts:8,18,33`, `WhatsAppController.ts:104,178`, `channels/index.ts:14`, `checkServicesHealth.ts` (linha do gateway). Nada mais precisa saber do motor |
| Frontend | `QrcodeModal/index.js:99`; `useWhatsApps/index.js:27-36` | corrigir o fechamento do modal por id; copiar `number` no `UPDATE_SESSION` (opcional) |

---

## 6. Decomposição sugerida (ordem; cada tarefa testável sozinha)

1. **Configuração e chave de motor** — `src/config/whatsappEngine.ts`
   (`engine()`, `gatewayConfig()`), checagem no `server.ts`,
   `.env.example`, `package.json` (`ioredis`, `mime-types` diretas).
   Teste: unidade da leitura/validação.
2. **Helpers neutros** — `helpers/mentions.ts` aceita `mentionedJID`;
   `lookupPhoneJidByLid` para `helpers/lidLookup.ts`; `sentByPlatform` para
   `channels/sentByPlatform.ts`; `libs/whatsappCache.ts` genérico (sem tipos do
   Baileys); `messageRef` com `text`; `kind` com `"whatsmeow"`;
   `SetTicketMessagesAsRead` sem `dataJson`. Arquivos: `helpers/mentions.ts`,
   `channels/baileys/toInbound.ts`, `channels/baileys/BaileysChannel.ts`,
   `channels/index.ts`, `channels/types.ts`, `libs/whatsappCache.ts`,
   `helpers/SetTicketMessagesAsRead.ts` + specs. Motor `baileys` continua
   verde.
3. **Cliente HTTP do gateway** — `src/channels/whatsmeow/client.ts`
   (envelope, token, timeouts, mapeamento de erros). Teste com axios
   simulado.
4. **Registro de estado + health** — `src/channels/whatsmeow/state.ts`
   (status por conexão, `gatewayUp`, poll de `GET /health` a cada 30 s).
5. **Mídia de passagem** — `src/channels/whatsmeow/media.ts`
   (`stageOutgoing(source)` → `{path, cleanup}`; `loadIncoming(client, id,
   rawMessage)` → `InboundMedia | null`, apaga o arquivo). Teste com pasta
   temporária.
6. **`WhatsmeowChannel`** — `src/channels/whatsmeow/WhatsmeowChannel.ts` +
   `getChannel` com a chave (`channels/index.ts`), mimetype em
   `channels/media.ts`. Teste: `WhatsmeowChannel.spec.ts` no modelo de
   `BaileysChannel.spec.ts` (corpo exato de cada rota, agrupamento do
   `markRead`, `quoted` das colunas, `ERR_WAPP_NOT_INITIALIZED`).
7. **Envelope → `InboundMessage`** — `src/channels/whatsmeow/toInbound.ts`
   (LID→telefone, `companyId`, `loadMedia`). Teste de unidade com envelopes
   reais do HM.
8. **Serviços comuns extraídos do listener/monitor** —
   `ApplyLidMappingService`, `MissedCallService` (de `wbotMonitor.ts:42-107`),
   fallback LID em `ContactTypingService.handlePresenceUpdate`; o
   `wbotMessageListener`/`wbotMonitor` passam a chamá-los (motor `baileys`
   sem mudança de comportamento). Specs dos três.
9. **Handlers por tipo de evento** — `src/channels/whatsmeow/handlers.ts`
   (`message` com eco/duplicidade/`verifyRecentCampaign`, `receipt`,
   `reaction`, `message_update`, `presence`, `lid_mapping`, `contacts`,
   `group_update`, `history` com o adaptador do importador, `call`).
   Teste por tipo com serviços simulados.
10. **Consumer Redis Streams** — `src/channels/whatsmeow/consumer.ts`
    (grupo, `XREADGROUP` multi-stream, fila por conexão, `XACK`,
    `XAUTOCLAIM`, 5 tentativas → `wa:dead` + `recordLog`, entrar/sair stream,
    métricas de atraso). Teste com Redis real do HM (`REDIS_URI` de teste)
    ou fake.
11. **Camada de sessão** — `src/services/WhatsmeowServices/SessionService.ts`
    (`start`, `restart`, `logout`, `remove`, `reconcileOnBoot`,
    `onConnection` com número em uso, presença inicial,
    `SyncSessionContactsService`) e a chave em `StartWhatsAppSession.ts`,
    `StartAllWhatsAppsSessions.ts`, `WhatsAppSessionController.ts`,
    `WhatsAppController.ts`, `server.ts`. Teste: specs do serviço e do
    controller (motor `whatsmeow`).
12. **Monitor do servidor** — `checkServicesHealth.ts`, `alerts.ts`,
    `GetServerMonitorService.ts`, `whatsapp-app/src/components/ServerMonitor/index.js`
    (+ `format.js`). Specs existentes de alerts/format.
13. **Frontend (pequeno)** — `QrcodeModal/index.js:99` por id;
    `useWhatsApps/index.js` copia `number`. Opcional.
14. **HM ponta a ponta com `WHATSAPP_ENGINE=whatsmeow`** — conexão nova por
    QR, conexão convertida (`migrate-baileys`), texto/mídia/áudio nos dois
    sentidos, citação de mensagem antiga (Baileys) e nova, menções (antigas
    `mentionedJid` e novas `mentionedJID`), apagar, editar, reagir, lida nos
    dois sentidos, digitando (com `showOnline`), recibos e presença em LID,
    chamada recusada com aviso, histórico (lotes, contatos, fim), eco não
    duplica, reentrega não duplica (derrubar a api no meio), gateway parado
    → `ERR_WAPP_NOT_INITIALIZED`, volta para `baileys` (gateway parado
    primeiro). Registrar no `README` do gateway e na memória do projeto.
