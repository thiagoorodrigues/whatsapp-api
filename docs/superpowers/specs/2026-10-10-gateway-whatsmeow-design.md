# Troca do Baileys pelo whatsmeow (gateway) — design

Data: 2026-10-10

## Objetivo

Tirar o Baileys do Wazzy e passar a falar com o WhatsApp pelo **whatsmeow**
(`go.mau.fi/whatsmeow`), que implementa mais do protocolo. É a etapa 4
(gateway) da separação do Baileys: a regra de negócio já fala só com
`MessagingChannel` (envio) e `InboundMessage` (recebimento); agora a
implementação por trás dessas duas interfaces passa a ser um serviço Go.

Sucesso = produção sem Baileys, com tudo que existe hoje funcionando
(texto, mídia, citação, encaminhada, menções, apagar, editar, reagir, lida,
presença, digitando, checar número, foto, grupos e membros, histórico, LID,
recibos, recusa de chamada) e espaço para recursos que só o whatsmeow tem
(ex.: pareamento por código no telefone).

## Decisões do usuário

- Troca **de uma vez**, num único deploy, sem convivência por conexão.
- As conexões (`Whatsapps`) continuam: nome, filas, configurações, contatos,
  tickets e mensagens ficam. Só o pareamento pode ter de ser refeito.
- **Teste de conversão das sessões** Baileys → whatsmeow antes do deploy. Se
  funcionar, ninguém lê QR; se falhar, plano B = todos leem o QR de novo.
- Comunicação **A**: HTTP para comandos (Node → Go) e **Redis Streams** para
  eventos (Go → Node).
- Gateway e api compartilham o volume `/app/public`. A mídia recebida é baixada
  **só quando o Wazzy vai gravar a mensagem** (como hoje): o gateway grava numa
  pasta de passagem `public/.gateway/` (o Express não serve arquivos que
  começam com ponto) e o Node move para a pasta da empresa.
- Nenhum cliente usa n8n: o `raw` do webhook pode mudar de formato.
- A API externa (`/api/messages/send`) continua igual.

## Fora do escopo

- Melhorias da API externa (devolver id, avisar entrega por webhook, grupos,
  citação). Trabalho separado, depois da troca.
- Canal da Meta Cloud API (etapa 5).
- Pareamento por código no telefone na tela (o gateway expõe o comando; a
  tela fica para depois).
- Apagar `BaileysKeys` e `Whatsapps.session`: só numa migration posterior,
  depois de alguns dias estáveis.

## Arquitetura

```
┌────────────── Wazzy (Node, whatsapp-api) ──────────────┐
│ regra de negócio (InboundServices, tickets, IA...)      │
│        ▲ InboundMessage            │ MessagingChannel   │
│ WhatsmeowConsumer (Redis)    WhatsmeowChannel (HTTP)    │
└────────▲───────────────────────────┼────────────────────┘
         │ Redis Streams             │ HTTP interno + token
┌────────┴───────────────────────────▼────────────────────┐
│ gateway Go (repo weconex-api-meow)                       │
│  sessões whatsmeow · comandos · publica eventos         │
│  Postgres schema "whatsmeow" · mídia no volume comum    │
└─────────────────────────────────────────────────────────┘
```

### Servidor (EasyPanel, projeto `wazzy`)

| Serviço | Muda |
|---|---|
| `api` | perde o Baileys; chama o gateway |
| `app` | nada |
| `postgres` | ganha o schema `whatsmeow` (chaves das sessões; entra no backup) |
| `redis` | ganha os streams `wa:events:{connectionId}` e `wa:dead` |
| **`gateway`** (novo) | Dockerfile do repo privado `thiagoorodrigues/weconex-api-meow` (pasta `~/Projetos/weconex/weconex-api-meow`); deploy no push da `main` |

`gateway`:
- **sem domínio público**; só a `api` acessa, pela rede interna
  (`http://wazzy_gateway:8080`), com header `Authorization: Bearer $GATEWAY_TOKEN`;
- monta o **mesmo volume** da `api` em `/app/public` e roda como root (igual à
  api), para poder escrever nele;
- variáveis: `POSTGRES_DSN` (banco do Wazzy, `search_path=whatsmeow`),
  `REDIS_URL`, `GATEWAY_TOKEN`, `HTTP_PORT=8080`, `LOG_LEVEL`;
- `api` ganha `GATEWAY_URL` e `GATEWAY_TOKEN`.
- Credenciais só no Environment do EasyPanel. O `docker-compose.prod.yml`
  atual do repo Go tem senha de Postgres no arquivo: remover do repo e trocar
  a senha se ela ainda for usada em algum lugar.

### Gateway Go

Só fala de WhatsApp; não conhece ticket, fila nem empresa.

- **Sessão = `Whatsapps.id`** (não mais UUID próprio). O gateway não sabe de
  empresa. A tabela `whatsmeow.gateway_sessions (connection_id, jid)` liga a
  conexão ao aparelho.
- Ao subir, restaura sozinho as sessões que estão em `whatsmeow_device`.
- Reconexão de rede fica com o whatsmeow.
- O código atual (`whatsapp/`, `http/`, webhook simples, `profile_media/`,
  `/stats` em memória) é reaproveitado onde servir e reorganizado.

**Comandos (HTTP, JSON, envelope `{success, data, error}` atual):**

| Método e rota | Uso |
|---|---|
| `GET /health` | vivo + nº de sessões conectadas |
| `POST /sessions/{id}/connect` | idempotente: sobe a sessão ou confirma |
| `POST /sessions/{id}/disconnect` | fecha o socket, mantém o pareamento |
| `POST /sessions/{id}/logout` | desfaz o pareamento e apaga as chaves |
| `GET /sessions/{id}` | status (`connecting`, `qr`, `connected`, `logged_out`) |
| `POST /sessions/{id}/pair-phone` `{phone}` | código de pareamento (sem tela por enquanto) |
| `POST /sessions/{id}/messages` | envio (ver abaixo) |
| `DELETE /sessions/{id}/messages/{msgId}` | apagar para todos |
| `PUT /sessions/{id}/messages/{msgId}` `{chat, text}` | editar |
| `POST /sessions/{id}/messages/{msgId}/reaction` `{chat, sender, fromMe, emoji}` | reagir (emoji vazio remove) |
| `POST /sessions/{id}/read` `{chat, sender, ids[]}` | marcar como lida |
| `POST /sessions/{id}/presence` `{presence}` | disponível / indisponível |
| `POST /sessions/{id}/typing` `{chat, state}` | digitando / gravando / parou |
| `POST /sessions/{id}/presence/subscribe` `{chat}` | assinar presença do contato |
| `POST /sessions/{id}/check` `{numbers[]}` | tem WhatsApp? devolve JID |
| `GET /sessions/{id}/avatar?jid=` | URL da foto |
| `GET /sessions/{id}/groups/{jid}` | assunto, descrição, criação, membros (LID, telefone, admin, eu) |
| `POST /sessions/{id}/calls/{callId}/reject` `{from}` | recusar chamada |
| `POST /sessions/{id}/media` `{message}` | baixa a mídia de uma mensagem (o `raw.message` guardado) para `public/.gateway/in/`; devolve `{path, mimetype, fileName}` ou `null` se o WhatsApp não tiver mais o arquivo |

`POST /messages` recebe `{to, content, quoted?, forwarded?}`:
- `to`: `{jid}` ou `{number, lid, isGroup}` (mesma resolução de hoje: LID
  quando conhecido);
- `content`: o `OutgoingContent` atual; mídia **sempre por `path`** relativo a
  `/app/public` (o Node grava `buffer`/upload em `public/.gateway/out/` antes e
  apaga depois); caminhos que saem da pasta são recusados;
- `quoted`: `{id, chat, sender, fromMe, text}` — a citação é montada a partir
  do que já está no banco, **sem depender do payload bruto**; mensagens
  antigas no formato Baileys continuam citáveis;
- resposta `{externalId, chatJid, raw}`.

Timeouts no cliente Node: 30 s nos comandos, 120 s em envio de mídia.

**Eventos (Redis Streams):**

Stream `wa:events:{connectionId}` (ordem por conexão). Envelope:

```json
{ "type": "message", "connectionId": 12, "ts": 1760100000000, "data": { } }
```

| `type` | `data` |
|---|---|
| `message` | quase o `InboundMessage`: `id, fromMe, history, timestamp, chat{jid,isGroup,name}, sender{jid,name,lid}, kind, channelType, text, hasMedia, media{mimetype,fileName}?, quotedId, editOf, forwarded, mentions, raw` |
| `receipt` | `ids[], chat, sender, status` (`delivered`/`read`/`played`) |
| `reaction` | `id` da mensagem alvo, `chat, sender, emoji, fromMe` |
| `message_update` | `id, chat, revoked` (apagada) — edição vem como `message` com `editOf` |
| `presence` | `chat, sender, state` (`composing`/`recording`/`paused`) |
| `lid_mapping` | `lid, pn` |
| `contacts` | lista `{jid, lid, name, notify}` |
| `group_update` | `jid` (o Node esquece o cache do grupo) |
| `history` | lote de `message` com `history: true` + `progress` |
| `call` | `event` (`offer`/`terminate`), `callId, from, isVideo, isGroup, ts` |
| `connection` | `status` (`qr` + `qr`, `pair_code` + `code`, `connected` + `me`, `disconnected`, `logged_out`) |

A tradução proto → envelope é feita em Go (perto do proto); o Node só
completa `companyId` e `loadMedia` (chama `POST /media`, lê o arquivo da
pasta de passagem e o apaga depois de gravar). O gateway apaga arquivos da
pasta de passagem com mais de 24 h.

### Wazzy (Node)

- `src/channels/whatsmeow/WhatsmeowChannel.ts`: implementa `MessagingChannel`
  por HTTP (`kind: "whatsmeow"`). `getChannel` passa a devolvê-lo.
  `isReady()` usa o status conhecido da conexão (eventos `connection`).
- `src/channels/whatsmeow/consumer.ts`: um consumer group (`wazzy-api`) por
  stream; processamento **em série por conexão**; `XACK` só depois de gravar.
  Falha → fica pendente e é reclamada (`XAUTOCLAIM`) de novo; após 5
  tentativas vai para `wa:dead` e para os Logs do sistema (com protocolo).
- Cada `type` cai no serviço que já trata o evento equivalente do Baileys
  (`InboundServices`, recibos, reações, `lid-mapping`, contatos, cache de
  grupos, `ContactTypingService`, `historyImport`, `wbotMonitor`/chamadas,
  status da conexão + socket do frontend).
- Eco: o whatsmeow também entrega o que nós enviamos; `sentByPlatform`
  continua ignorando pelo id, agora no consumer.
- Duplicidade: o id da mensagem segue como chave (checagem atual em
  `Message`).
- Sessão: camada fina que chama `connect`/`disconnect`/`logout` e repassa QR
  e status ao frontend como hoje. Ao subir, a api chama `connect` para cada
  conexão ativa.
- Health: a api checa `GET /health` a cada 30 s; o Monitor do servidor ganha
  a linha do gateway.
- Gateway fora do ar → `isReady()` falso → `ERR_WAPP_NOT_INITIALIZED` (o
  frontend já trata).

**Sai:** `libs/wbot.ts`, `helpers/authState.ts`, `helpers/baileysKeyStore.ts`,
`helpers/reconnectPolicy.ts`, `helpers/serialQueue.ts`, `channels/baileys/`
(exceto o que for reaproveitado, como `sentByPlatform`), os serviços
`Baileys*`, o listener e o pacote `@whiskeysockets/baileys`. Os modelos e
tabelas `BaileysKeys` e `Whatsapps.session` **ficam** até a migration de
limpeza.

**`Message.dataJson`:** mensagens novas guardam
`{ key: {id, remoteJid, fromMe, participant}, message: <proto em protojson> }`,
mesmo formato de topo do Baileys. O frontend não lê `dataJson`. Leitores na
api:
- `helpers/mentions.ts` (`getMentionedJids`, usado por
  `ResolveMentionsService` e `BackfillMentionPreviewsService`): passa a aceitar
  as duas grafias do campo (`mentionedJid` do Baileys e `mentionedJID` do
  protojson), para ler mensagens antigas e novas;
- `SetTicketMessagesAsRead`: deixa de depender de `dataJson`; usa
  `messagesWhatsappsId`, `remoteJid`, `participant` e `fromMe`;
- `BaileysChannel` (citação/reenvio): sai; a citação usa colunas do banco.

## Conversão das sessões (teste antes do deploy)

Comando `migrate-baileys` no binário do gateway:
1. lê `Whatsapps.session` (creds) e `BaileysKeys` (pre-keys, sessions,
   sender-keys, app-state-sync-keys, lid-mapping) de cada conexão;
2. grava `whatsmeow_device`, `whatsmeow_identity_keys`, `whatsmeow_pre_keys`,
   `whatsmeow_sessions`, `whatsmeow_sender_keys`,
   `whatsmeow_app_state_sync_keys`, `whatsmeow_lid_map` com o `jid` do
   aparelho e o id da conexão como chave de sessão;
3. não altera nada do lado Baileys.

Critérios no HM (conexão de teste com celular real):
- conecta sem QR;
- recebe e envia no privado e em grupo (incluindo grupo antigo, que usa
  sender keys);
- o celular não mostra aparelho novo e não aparecem mensagens "aguardando".

Qualquer falha → plano B (QR para todos) e o comando é descartado.

## Virada em produção

1. Deploy do `gateway` ainda sem tráfego (api antiga segue no Baileys).
2. Parar a `api` (o Baileys não pode mexer nas chaves durante a cópia).
3. Rodar `migrate-baileys` (se o teste passou).
4. Deploy da `api` sem Baileys; ela chama `connect` para cada conexão.
5. Conferir no Monitor que todas estão conectadas; as que falharem pedem QR
   e só esses clientes são avisados.

**Volta atrás:** **parar o `gateway` primeiro** (dois clientes com as mesmas
chaves derrubam um ao outro) e reverter a `api`; `BaileysKeys` e
`Whatsapps.session` estão intactos.

## Testes

- **Go:** unitários da tradução proto → envelope (um por tipo de mensagem e
  de evento) e do conversor de sessão.
- **Node:** `WhatsmeowChannel` com HTTP simulado (modelo:
  `BaileysChannel.spec.ts`); consumer (ACK, retentativa, `wa:dead`, eco
  ignorado, ordem por conexão).
- **Ponta a ponta no HM** com celular real, incluindo o que nunca teve teste
  real: reações, edição, digitando, nota interna, não lidas, histórico.

## Riscos

- Conversão de sessão não é caminho oficial de nenhuma das duas bibliotecas.
  Mitigação: teste no HM + plano B.
- Deploy único afeta todos os clientes. Mitigação: chaves antigas intactas e
  procedimento de volta atrás.
- Volume comum entre dois serviços: permissão de escrita do usuário do
  container Go (`appuser`) precisa bater com a da api.
