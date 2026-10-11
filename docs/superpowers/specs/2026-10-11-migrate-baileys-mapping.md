# migrate-baileys: mapeamento Baileys → whatsmeow

Data: 2026-10-11. Pesquisa somente leitura. Nada foi gravado em banco.

Objetivo: um conversor único (`migrate-baileys`, Go, no repo `weconex-api-meow`) que lê uma sessão Baileys já pareada no Postgres do Wazzy e grava as tabelas do sqlstore do whatsmeow (schema `whatsmeow`), para que o **mesmo aparelho vinculado** continue funcionando sem ler o QR de novo.

Versões conferidas:

| Lado | Versão | Onde |
|---|---|---|
| Baileys | `@whiskeysockets/baileys` 7.0.0-rc14 | `whatsapp-api/node_modules/@whiskeysockets/baileys/package.json` |
| libsignal do Baileys | `libsignal` 6.0.0 (aninhado) | `node_modules/@whiskeysockets/baileys/node_modules/libsignal` |
| whatsmeow | `v0.0.0-20261007111105-c386243a72ba` | volume `wazzy-gomod` |
| libsignal do whatsmeow | `go.mau.fi/libsignal v0.2.2` | `whatsmeow/go.mod` |

Os caminhos de arquivo abaixo são relativos a cada módulo (`baileys/lib/...`, `libsignal-node/src/...`, `whatsmeow/...`, `go-libsignal/...`).

## Veredito rápido

| Classe | Veredito | Por quê |
|---|---|---|
| Device (noise, identity, signed pre-key, registration id, ADV/account, JID, LID) | **MUST** | Sem isso o login falha ou o aparelho cai (401/logout). Conversão direta e sem perda. |
| Pre-keys (privadas) | **SHOULD, na prática MUST** | O servidor ainda guarda as pre-keys públicas que o Baileys subiu (ids 1..812 no HM). Sem as privadas, todo `pkmsg` que usar uma delas falha; e o whatsmeow reaproveitaria ids já publicados. |
| Sessões 1:1 (`session`) | **SHOULD** | Conversão possível e sem perda de estado criptográfico (só metadados). Sem elas, a primeira mensagem de cada contato falha e depende de retry receipt. |
| Sender keys recebidas (`sender-key` de terceiros) | **SHOULD** | Conversão 1:1. Sem elas, a primeira mensagem de cada membro em cada grupo falha e depende de retry. |
| Sender key própria | **CAN skip** | O whatsmeow cria uma nova e manda SKDM para todos os participantes a cada envio em grupo (`send.go:781-806`). |
| Identity keys de contatos | **SHOULD (barato)** | Sem elas o whatsmeow confia na primeira chave que vir (`IsTrustedIdentity` devolve true quando não conhece, `store/sqlstore/store.go:97-108`). |
| Identidade do aparelho principal (nossa) | **SHOULD** | O whatsmeow grava no pareamento (`pair.go:221-229`); o Baileys guarda em `creds.signalIdentities`. |
| Mapa LID↔PN (`lid-mapping`) | **SHOULD** | As sessões do Baileys estão quase todas em endereço LID; sem o mapa, envio para telefone não acha a sessão LID e abre sessão nova (`send.go:1294-1320`). |
| App-state sync keys | **SHOULD** | Sem elas os patches de app state não decifram e o whatsmeow pede as chaves ao celular (`appstate.go:165`, `requestMissingAppStateKeys`). |
| App-state versions (hash LTHash + MACs) | **SHOULD com verificação, ou CAN skip** | Converter só se o hash recalculado bater; senão pular a coleção e deixar o whatsmeow fazer snapshot (versão 0 ⇒ full sync, `appstate.go:56-60`). |
| tctoken (privacy tokens) | **CAN skip (barato converter)** | O whatsmeow volta a receber tokens; converter evita uma janela sem token. |
| device-list, `processedHistoryMessages`, `routingInfo`, `lastPropHash`, `accountSyncCounter`, `pairingEphemeralKeyPair`, `registered`, `accountSettings`, `myAppStateKeyId` | **CAN skip** | Sem tabela equivalente no whatsmeow, ou é cache/estado que ele refaz. |

## 1. Inventário no HM

Postgres `whatsapp-api-postgres-1`, db `sweasy`. Só existe uma conexão Baileys: `Whatsapps.id = 3`, `status = CONNECTED`, `provider = beta`. `Whatsapps.session` tem 2.754 caracteres.

### 1.1 `BaileysKeys` (whatsappId = 3)

| type | linhas | formato do `keyId` | formato do `value` (JSON com BufferJSON) |
|---|---|---|---|
| `pre-key` | 801 (ids 1..812, 11 consumidas) | `"<id>"` | `{private: Buffer(32), public: Buffer(32)}` |
| `session` | 14 | `"<user>[_<domainType>].<device>"`, ex. `N_1.0`, `N_1.36` | `SessionRecord.serialize()` do libsignal-node (seção 3) |
| `sender-key` | 3 (1 grupo, 1 remetente, devices 0/36/39) | `"<grupo>@g.us::<user>[_<domain>]::<device>"` | `Buffer` cujo conteúdo é JSON UTF-8 de `[SenderKeyState...]` (seção 3.4) |
| `identity-key` | 11 | igual a `session` | `Buffer(33)`, primeiro byte `0x05` |
| `lid-mapping` | 392 (196 pares) | `"<pnUser>"` → `"<lidUser>"` e `"<lidUser>_reverse"` → `"<pnUser>"` | string só com dígitos |
| `app-state-sync-key` | 9 | base64 do keyId (6 bytes), ex. `AAAAAJr0` | `{keyData: base64(32), fingerprint: {rawId, currentIndex, deviceIndexes[]}, timestamp: "<ms em string>"}` |
| `app-state-sync-version` | 5 | `critical_block`, `critical_unblock_low`, `regular`, `regular_high`, `regular_low` | `{version: n, hash: Buffer(128), indexValueMap: {"<base64 indexMac 32B>": {valueMac: Buffer(32)}}}` (ex.: 176 entradas em `critical_unblock_low`) |
| `device-list` | 5 | `"<user>"` | `["0","42","46"]` |
| `tctoken` | 6 (5 + índice) | `"<lidUser>@lid"` e `__index` | `{token: Buffer(11..), timestamp: "<unix s>", senderTimestamp?: <unix s>}`; `__index` = JSON de lista de JIDs (ignorar) |

Não há `sender-key-memory` nem `app-state-sync-key` órfã. Observação sobre o BufferJSON do Wazzy (`src/helpers/baileysKeyStore.ts`): grava `{type:"Buffer", data:"<base64>"}`; o reviver também aceita `data` como array de números e objetos `{"0":..,"1":..}` (formato antigo). O conversor precisa aceitar os três, e também o caso do `sender-key`, cujo conteúdo interno usa `{type:"Buffer", data:[números]}` (é o `BufferJSON` do próprio Baileys, `JSON.stringify` sem o replacer do Wazzy).

### 1.2 `Whatsapps.session` (`{creds}`)

Campos presentes (tamanhos em bytes depois de decodificar):

| Campo | Tipo/tamanho |
|---|---|
| `noiseKey.{private,public}` | Buffer 32 / 32 |
| `pairingEphemeralKeyPair.{private,public}` | Buffer 32 / 32 (só usado no pareamento por código) |
| `signedIdentityKey.{private,public}` | Buffer 32 / 32 |
| `signedPreKey.keyPair.{private,public}` | Buffer 32 / 32 |
| `signedPreKey.signature` | Buffer 64 |
| `signedPreKey.keyId` | número (1 no HM) |
| `registrationId` | número (cabe em 14 bits no Baileys) |
| `advSecretKey` | **string base64** (44 chars → 32 bytes), não Buffer |
| `account.details` | **string base64** (24 chars → 18 bytes) |
| `account.accountSignatureKey` | string base64 → 32 bytes |
| `account.accountSignature` | string base64 → 64 bytes |
| `account.deviceSignature` | string base64 → 64 bytes |
| `me.id` | `"<telefone>:<device>@s.whatsapp.net"` (ex. formato `999999999999:99@s.whatsapp.net`) |
| `me.lid` | `"<lid>:<device>@lid"` |
| `me.name` | push name atual |
| `signalIdentities` | `[{identifier:{name:"<me.lid com device>", deviceId:0}, identifierKey: Buffer(33) 0x05…}]` |
| `platform` | string (ex. `smba`) |
| `nextPreKeyId` / `firstUnuploadedPreKeyId` | 813 / 813 no HM |
| `processedHistoryMessages`, `accountSyncCounter`, `accountSettings`, `registered`, `routingInfo` (Buffer 6), `lastAccountSyncTimestamp`, `lastPropHash`, `myAppStateKeyId` | sem destino |

Por que `account` vira strings base64: o Baileys guarda o objeto protobufjs `ADVSignedDeviceIdentity` (`baileys/lib/Utils/validate-connection.js:150-191`); `JSON.stringify` chama o `toJSON()` do protobufjs antes do replacer, e campos `bytes` saem em base64. Na volta o Baileys recebe strings e o `encode` do protobufjs aceita base64. O conversor deve decodificar base64 dos quatro campos (aceitar também Buffer, por segurança).

Conferido no HM: as quatro chaves privadas (noise, identity, signed pre-key, uma pre-key) já estão "clamped" e a pública derivada por X25519 a partir da privada bate com a pública guardada. Logo `keys.NewKeyPairFromPrivateKey` do whatsmeow (que deriva a pública, `store/sqlstore/container.go:113-116`) reproduz exatamente as mesmas chaves.

## 2. Mapeamento para o whatsmeow

Esquema de destino: `whatsmeow/store/sqlstore/upgrades/00-latest-schema.sql` (v16). Todas as tabelas por aparelho usam `jid`/`our_jid` = `Device.ID.String()`.

### 2.1 `whatsmeow_device` (MUST)

Gravar com `container.PutDevice(ctx, device)` (`container.go:217-235`) depois de `container.Upgrade`. `PutDevice` só grava o que está em `Device`; o `ON CONFLICT (jid)` atualiza apenas lid/platform/business/push_name, então rodar de novo **não** troca chaves (para refazer, apagar o device antes).

| Coluna / campo `store.Device` | Origem Baileys | Transformação |
|---|---|---|
| `jid` / `ID` | `creds.me.id` | `types.ParseJID`. Formato idêntico nos dois lados: `user:device@s.whatsapp.net` (`types/jid.go:218-230`; o Baileys usa o `jid` do nó `pair-success/device`, `validate-connection.js:139`). Exigir `Device > 0`. |
| `lid` / `LID` | `creds.me.lid` | `ParseJID`, mantendo o device (`xxx:NN@lid`). O whatsmeow guarda o `lid` do mesmo nó com device (`pair.go:216`). Se faltar, o whatsmeow preenche no `connect success` (`connectionevents.go:176-185`). |
| `registration_id` | `creds.registrationId` | uint32 direto. Precisa ser `< 2^32` (sempre é). |
| `noise_key` | `creds.noiseKey.private` | 32 bytes. A pública é derivada. |
| `identity_key` | `creds.signedIdentityKey.private` | 32 bytes. |
| `signed_pre_key` | `creds.signedPreKey.keyPair.private` | 32 bytes. |
| `signed_pre_key_id` | `creds.signedPreKey.keyId` | inteiro, `< 16777216`. |
| `signed_pre_key_sig` | `creds.signedPreKey.signature` | 64 bytes, sem mudança (assinatura XEdDSA sobre `0x05‖pub`, igual nos dois). |
| `adv_key` / `AdvSecretKey` | `creds.advSecretKey` | base64 → 32 bytes. Só é usado na verificação do HMAC do pareamento (`pair.go:150`). |
| `adv_details` / `Account.Details` | `creds.account.details` | base64 → bytes (protobuf `ADVDeviceIdentity`, 18 bytes no HM). |
| `adv_account_sig` | `creds.account.accountSignature` | base64 → 64 bytes. |
| `adv_account_sig_key` | `creds.account.accountSignatureKey` | base64 → 32 bytes. Se vier vazio (Baileys antigo), usar `creds.signalIdentities[0].identifierKey[1:]` (33 → 32). |
| `adv_device_sig` | `creds.account.deviceSignature` | base64 → 64 bytes. O Baileys calcula com o mesmo prefixo e a mesma mensagem do whatsmeow (`validate-connection.js:160-166` × `pair.go:198`), então não recalcular. |
| `platform` | `creds.platform` | string (`""` se ausente). |
| `business_name` | — | `""`. O Baileys não guarda o nome comercial separado (só usou em `me.name` no pareamento). |
| `push_name` | `creds.me.name` | string. Importante: o whatsmeow recusa `SendPresence` sem push name. |
| `facebook_uuid` | — | NULL (só Messenger). |
| `lid_migration_ts` | — | 0. O whatsmeow preenche a partir de mensagens de protocolo/configurações (`message.go:1071-1105`). |
| `companion_meta_nonce` | — | `""`. Preenchido pelo history sync (`message.go:815`). |
| `Initialized` | — | não é coluna; `PutDevice` chama `initializeDevice` (`container.go:231-243`). |

Sobre prefixo `0x05`: as tabelas do whatsmeow guardam chaves Curve25519 **sem** prefixo (32 bytes, ver `CHECK length = 32`); o Baileys guarda `creds.*` sem prefixo (32) e adiciona `0x05` só ao entregar ao libsignal (`generateSignalPubKey`, `baileys/lib/Signal/libsignal.js:424-430`). Dentro dos registros de sessão/sender key os dois lados usam 33 bytes com `0x05` (seção 3).

### 2.2 `whatsmeow_pre_keys` (SHOULD, na prática MUST)

| Coluna | Origem | Transformação |
|---|---|---|
| `jid` | device | `me.id` |
| `key_id` | `keyId` da linha `pre-key` | inteiro, `< 16777216` |
| `key` | `value.private` | 32 bytes (a pública é derivada em `scanPreKey`, `store.go:372-386`) |
| `uploaded` | — | `true` se `key_id < creds.firstUnuploadedPreKeyId`, senão `false` |

Não há método exportado para inserir pre-key com chave dada: usar SQL direto (`INSERT INTO whatsmeow_pre_keys (jid, key_id, key, uploaded) VALUES ...`).

Cuidado com o próximo id: o whatsmeow usa `MAX(key_id)+1` como próximo id (`getNextPreKeyID`, `store.go:305-312`), não um contador. O Baileys usa `creds.nextPreKeyId`. Se a pre-key de maior id já tiver sido consumida (apagada), o whatsmeow geraria um id que o servidor já conhece. Regra: se `MAX(key_id convertido) < nextPreKeyId - 1`, inserir uma pre-key nova aleatória com `key_id = nextPreKeyId - 1` e `uploaded = true` (nunca será pedida, só segura o contador). No HM: máximo 812, `nextPreKeyId` 813 — não precisa.

No connect o whatsmeow compara a contagem local `uploaded=true` com a do servidor e só sobe novas se uma delas for `< 5` (`connectionevents.go:187-198`, `prekeys.go:26-30`). Com as 801 convertidas não sobe nada. Se as pre-keys forem puladas, `dbCount == 0` e ele sobe 50 novas com ids 1..50 (colidindo com os ids do Baileys ainda publicados).

### 2.3 `whatsmeow_identity_keys` (SHOULD)

| Coluna | Origem | Transformação |
|---|---|---|
| `our_jid` | device | `me.id` |
| `their_id` | `keyId` de `identity-key` | trocar o **último** `.` por `:` (ver 3.5). Ex. `N_1.36` → `N_1:36` |
| `identity` | `value` | Buffer(33) → remover o `0x05` → 32 bytes. Rejeitar se o primeiro byte não for `0x05`. |

Mais uma linha para o aparelho principal (como o whatsmeow faz no pareamento, `pair.go:211-224`): `their_id = "<lidUser>_1:0"` (de `me.lid` sem device), `identity = account.accountSignatureKey` (32 bytes). Se já existir uma linha `identity-key` com esse endereço, as duas devem ser iguais. Usar `PutIdentity` (upsert).

### 2.4 `whatsmeow_lid_map` (SHOULD)

Tabela global (sem `our_jid`), colunas `lid` e `pn` com **só a parte do usuário** (o whatsmeow consulta por `source.User`, `lidmap.go:93-112`). Usar `container.LIDMap.PutManyLIDMappings` com `LIDMapping{LID: <lid>@lid, PN: <pn>@s.whatsapp.net}`.

- Origem: linhas `lid-mapping` com `keyId` sem sufixo: `keyId` = pnUser, `value` = lidUser. As linhas `<lid>_reverse` são o inverso; usar só para completar pares que faltem.
- Incluir o par do próprio aparelho: `me.lid.User` ↔ `me.id.User`.
- `pn` é `UNIQUE`: `PutManyLIDMappings` já apaga o mapeamento antigo do mesmo pn. Hosted (`@hosted`, `@hosted.lid`) é recusado pelo whatsmeow (`lidmap.go:197-200`); ignorar.

### 2.5 `whatsmeow_app_state_sync_keys` (SHOULD)

| Coluna | Origem | Transformação |
|---|---|---|
| `jid` | device | `me.id` |
| `key_id` | `keyId` | base64 → bytes (6 bytes no HM). O Baileys grava `Buffer.from(keyId.keyId).toString('base64')` (`process-message.js:283-287`). |
| `key_data` | `value.keyData` | base64 → 32 bytes |
| `timestamp` | `value.timestamp` | string (int64 do protobufjs) → `int64`. É o mesmo campo `AppStateSyncKeyData.timestamp` que o whatsmeow grava cru (`message.go:842-846`); no HM tem 13 dígitos (ms). |
| `fingerprint` | `value.fingerprint` | **remontar** `waE2E.AppStateSyncKeyFingerprint{RawID, CurrentIndex, DeviceIndexes}` e `proto.Marshal` (o whatsmeow guarda o protobuf serializado, `message.go:833`). |

Usar `PutAppStateSyncKey`.

### 2.6 `whatsmeow_app_state_version` e `whatsmeow_app_state_mutation_macs` (SHOULD com verificação)

Os nomes das coleções são iguais nos dois lados.

| Coluna | Origem |
|---|---|
| `version` | `value.version` (nunca gravar 0: o whatsmeow trata versão 0 salva como erro, `store.go:500-503`) |
| `hash` | `value.hash`, 128 bytes |
| `mutation_macs.index_mac` | chave de `indexValueMap`, base64 → 32 bytes |
| `mutation_macs.value_mac` | `indexValueMap[k].valueMac`, 32 bytes |
| `mutation_macs.version` | o mesmo `value.version` para todas (o Baileys não guarda a versão de cada MAC; a consulta do whatsmeow pega o maior `version` por `index_mac`, `store.go:484`) |

Usar `PutAppStateVersion` e depois `PutAppStateMutationMACs` (FK para a versão).

Verificação obrigatória antes de gravar cada coleção: `lthash.WAPatchIntegrity.SubtractThenAdd(make([]byte,128), nil, todosValueMACs)` deve ser igual a `hash`. Se não bater, **não gravar** a coleção: com versão 0 o whatsmeow faz snapshot completo na próxima sincronização (`appstate.go:56-60`). Gravar um estado inconsistente é pior que pular, porque o próximo patch falha com `mismatching LTHash` e o whatsmeow só emite `AppStateSyncError`, sem refazer sozinho (`appstate.go:163-171`).

Nota: o snapshot de quem pulou gera eventos com `FullSync`; o whatsmeow só os despacha se `EmitAppStateEventsOnFullSync` estiver ligado (`appstate.go:68-72`); o gateway não liga.

### 2.7 `whatsmeow_privacy_tokens` (CAN skip, barato)

| Coluna | Origem |
|---|---|
| `their_jid` | `keyId` (`<lid>@lid`), já sem device; ignorar `__index` |
| `token` | `value.token` |
| `timestamp` | `value.timestamp` (string, unix em segundos) |
| `sender_timestamp` | `value.senderTimestamp` (unix s) ou NULL quando ausente (4 de 5 no HM) |

Usar `PutPrivacyTokens` com `time.Unix(...)`.

### 2.8 `gateway_sessions` (do gateway)

`INSERT INTO whatsmeow.gateway_sessions (connection_id, jid) VALUES (<Whatsapps.id>, '<me.id>')`. `loadJID` faz `ParseJID` e `GetDevice` procura por esse texto (`internal/session/store.go:26-46`, `manager.go:143-160`).

### 2.9 Sem destino

`device-list` (o whatsmeow mantém só em memória), `whatsmeow_contacts` (preenchido por push names/app state), `whatsmeow_chat_settings` (vem do app state), `whatsmeow_message_secrets` (o Baileys não guarda; mensagens antigas de enquete/reação cifrada não serão decifráveis), `whatsmeow_nct_salt`, `whatsmeow_event_buffer`, `whatsmeow_retry_buffer`.

## 3. Sessões e sender keys

### 3.1 Formato de armazenamento do whatsmeow: é JSON, não protobuf

Apesar do nome, `store.SignalProtobufSerializer = serialize.NewProtoBufSerializer()` (`whatsmeow/store/signal.go:22`) usa **serializadores JSON** para sessão, estado e sender key (`go-libsignal/serialize/ProtoBufferSerializer.go:17-31`: `State = &JSONStateSerializer{}`, `Session = &JSONSessionSerializer{}`, `SenderKeyRecord = &JSONSenderKeySessionSerializer{}`, `SenderKeyState = &JSONSenderKeyStateSerializer{}`). O `.proto` `LocalStorageProtocol.proto` **não** é usado para gravar. Os bytes em `whatsmeow_sessions.session` e `whatsmeow_sender_keys.sender_key` são `encoding/json` destas structs Go (sem tags; `[]byte` vira base64):

- `record.SessionStructure{SessionState *StateStructure; PreviousStates []*StateStructure}` (`state/record/SessionRecord.go:92-95`)
- `record.StateStructure{LocalIdentityPublic, LocalRegistrationID, NeedsRefresh, PendingKeyExchange, PendingPreKey, PreviousCounter, ReceiverChains, RemoteIdentityPublic, RemoteRegistrationID, RootKey, SenderBaseKey, SenderChain, SessionVersion}` (`SessionState.go`)
- `record.ChainStructure{SenderRatchetKeyPublic, SenderRatchetKeyPrivate, ChainKey *chain.KeyStructure{Key, Index}, MessageKeys []*message.KeysStructure{CipherKey, MacKey, IV, Index}}`
- `record.PendingPreKeyStructure{PreKeyID *optional.Uint32{Value, IsEmpty}, SignedPreKeyID uint32, BaseKey []byte}`
- `groupRecord.SenderKeyStructure{SenderKeyStates []*SenderKeyStateStructure}`, `SenderKeyStateStructure{Keys []*ratchet.SenderMessageKeyStructure{Iteration, IV, CipherKey, Seed}, KeyID, SenderChainKey{Iteration, ChainKey}, SigningKeyPrivate, SigningKeyPublic}`

Recomendação de implementação: montar as structs com os tipos da própria lib e validar com `record.NewSessionFromStructure(s, ser.Session, ser.State)` e `.Serialize()` (e `groupRecord.NewSenderKeyFromStructure` / `.Serialize()`), em vez de escrever JSON à mão. `NewStateFromStructure` chama `ecc.DecodePoint` em `LocalIdentityPublic`, `RemoteIdentityPublic` e `SenderBaseKey`, e `NewChainFromStructure(SenderChain)`: **qualquer um vazio/nil causa panic** (índice fora do slice / ponteiro nil). Então esses campos são obrigatórios.

### 3.2 SessionRecord: libsignal-node → go-libsignal

libsignal-node (`src/session_record.js`) guarda `{_sessions: {<base64 baseKey>: SessionEntry}, version: "v1"}`; cada entrada tem `registrationId`, `currentRatchet{ephemeralKeyPair{pubKey,privKey}, lastRemoteEphemeralKey, previousCounter, rootKey}`, `indexInfo{baseKey, baseKeyType, closed, used, created, remoteIdentityKey}`, `_chains{<base64 ratchet pub>: {chainKey{counter, key?}, chainType, messageKeys{<idx>: base64}}}` e opcional `pendingPreKey{baseKey, signedKeyId, preKeyId?}`. Todos os bytes são strings base64 (não BufferJSON). Chaves públicas com 33 bytes (`0x05`), privadas 32.

Regras:

- **Qual entrada vira `SessionState`**: a aberta (`indexInfo.closed === -1`; só pode haver uma, `getOpenSession`). As fechadas viram `PreviousStates`, ordenadas por `indexInfo.used` decrescente (o Go tenta nessa ordem), no máximo 40 (`archivedStatesMaxLength`, `SessionRecord.go:9`).
- **Registro sem entrada aberta**: pular e logar. O libsignal-node também não cifra com ele (`haveOpenSession` falso), e promover uma fechada para `SessionState` faria o whatsmeow enviar com uma sessão que o contato já descartou. Sem registro, o envio abre sessão nova pelo bundle.

Campo a campo (para cada entrada convertida):

| go `StateStructure` | origem libsignal-node | transformação |
|---|---|---|
| `SessionVersion` | — | `3` (`protocol.CurrentVersion`) |
| `LocalIdentityPublic` | `creds.signedIdentityKey.public` | `0x05 ‖ pub` (33) |
| `LocalRegistrationID` | `creds.registrationId` | — |
| `RemoteIdentityPublic` | `indexInfo.remoteIdentityKey` | já 33 com `0x05` |
| `RemoteRegistrationID` | `entry.registrationId` | — |
| `RootKey` | `currentRatchet.rootKey` | 32 |
| `PreviousCounter` | `currentRatchet.previousCounter` | `max(0, valor)` (o node pode guardar -1 se a cadeia anterior nunca enviou; o Java/Go usaria 0; o receptor só deriva uma chave a mais). No HM nenhuma é negativa. |
| `SenderBaseKey` | `indexInfo.baseKey` | 33. Mesmo significado nos dois: base key do iniciador (nossa se `baseKeyType=1`, deles se `2`). É o `aliceBaseKey`. |
| `SenderChain.SenderRatchetKeyPublic` | `currentRatchet.ephemeralKeyPair.pubKey` | 33 |
| `SenderChain.SenderRatchetKeyPrivate` | `currentRatchet.ephemeralKeyPair.privKey` | 32 |
| `SenderChain.ChainKey` | `_chains[pubKey]` com `chainType = 1` | `{Index: counter + 1, Key: key}` (ver índices abaixo) |
| `SenderChain.MessageKeys` | — | vazio (o node não guarda chaves da cadeia de envio) |
| `ReceiverChains[]` | cada `_chains[k]` com `chainType = 2` | `SenderRatchetKeyPublic = base64decode(k)` (33), sem privada, `ChainKey{Index: counter+1, Key: key ou nil}`, `MessageKeys` derivadas (abaixo) |
| `PendingPreKey` | `pendingPreKey` | `{PreKeyID: optional.NewOptionalUint32(preKeyId)` ou `optional.NewEmptyUint32()`, `SignedPreKeyID: signedKeyId, BaseKey: baseKey (33)}` |
| `PendingKeyExchange` | — | nil |
| `NeedsRefresh` | — | false |

Índice das cadeias (verificado no código): no node `fillMessageKeys` grava a chave de mensagem em `counter+1` e avança (`session_cipher.js:256-270`); o envio usa a chave de índice `counter` depois de avançar (`session_cipher.js:81-92`). Ou seja, `{counter: c, key: K}` no node significa "última chave consumida = c, `K` é a chave de cadeia do índice c+1". No Go `chain.Key{Index: i, Key: K}` é a chave que gera a mensagem `i` (`getOrCreateMessageKeys`, `session/SessionCipher.go:333-355`). Portanto `Index = counter + 1`. A cadeia nova do node começa em `counter: -1` ⇒ `Index 0`, igual ao Go.

Chaves de mensagem guardadas (mensagens fora de ordem): o node guarda só a semente (`calculateMAC(chainKey, 0x01)`); o Go guarda as chaves derivadas. Derivar: `kdf.DeriveSecrets(seed, nil, []byte("WhisperMessageKeys"), 80)` → `CipherKey = [0:32]`, `MacKey = [32:64]`, `IV = [64:80]`, `Index = <idx>`. É a mesma HKDF que o node faz (`crypto.deriveSecrets(seed, zero32, "WhisperMessageKeys")`, iv = `keys[2][:16]`), e a mesma que o Go usa em `chain.Key.MessageKeys()` (`keys/chain/ChainKey.go:90-105`). Limite 2000 por cadeia (`maxMessageKeys`).

Cadeias de recebimento fechadas (`chainKey.key` ausente: o node apaga a chave ao girar o ratchet, `session_cipher.js:276-281`): o Go não tem o conceito. Se a cadeia ainda tiver `messageKeys`, mantê-la com `Key = nil` (só as chaves guardadas serão usadas; um contador acima do índice falha com MAC inválido, o mesmo resultado do "Chain closed" do node). Se não tiver `messageKeys`, descartar. O Go guarda no máximo 5 cadeias de recebimento, da mais antiga para a mais nova (`AddReceiverChain` remove `[0]`, `SessionState.go:270-280`); o node não poda (até 10 por entrada no HM). Manter a ordem de inserção do objeto `_chains` (ordem de criação; as chaves base64 não são numéricas) e ficar com as 5 últimas, garantindo que a de `lastRemoteEphemeralKey` esteja entre elas.

Bob antes do primeiro decrypt: no node, quem recebe a sessão (não iniciador) não tem cadeia de envio até o primeiro `maybeStepRatchet` (`session_builder.js:124-145`), mas a sessão só é gravada depois de decifrar, então na prática sempre existe `_chains[ephemeralKeyPair.pubKey]` com `chainType 1`. Conferido no HM: 15/15 entradas têm cadeia de envio. Se faltar, pular a entrada (senão o Go dá panic). Diferença de inicialização entre os dois (o Java/Go cria cadeia de envio de Bob e cadeia de recebimento extra de Alice no início) não importa depois do primeiro passo do ratchet: as derivações a partir daí são idênticas.

Perdas (não afetam a criptografia): `indexInfo.created/used/closed` (a ordem de `PreviousStates` preserva o essencial), `baseKeyType` (implícito), contadores de cadeias fechadas sem chaves. Conclusão: **conversão sem perda do estado necessário para cifrar/decifrar**.

Números do HM: 14 registros, 15 entradas (14 abertas, 1 fechada), 2 com `pendingPreKey` (ambas com `preKeyId`), 31 cadeias de recebimento fechadas, 1 chave de mensagem guardada no total.

### 3.3 Endereço da sessão (`their_id`)

| | Formato | Código |
|---|---|---|
| Baileys | `"<user>[_<domainType>].<device>"` | `jidToSignalProtocolAddress` (`baileys/lib/Signal/libsignal.js`): sufixo `_<domainType>` quando o domínio não é WhatsApp (LID=1, HOSTED=128, HOSTED_LID=129, `WABinary/jid-utils.js:9-12`); `ProtocolAddress.toString()` = `id.deviceId` |
| whatsmeow | `"<user>[_<agent>]:<device>"` | `JID.SignalAddressUser()` usa `ActualAgent()` com os mesmos números (`types/jid.go:77-119`); `SignalAddress.String()` = `name:deviceID` (`go-libsignal/protocol/SignalProtocolAddress.go:7,36-38`) |

Conversão: trocar o último `.` por `:`. Ex.: `125778553495594_1.36` → `125778553495594_1:36`; telefone `5511999999999.0` → `5511999999999:0`. O mesmo vale para `identity-key`. No HM todas as sessões já estão em endereço LID (`_1`); o Baileys 7 migra PN→LID (`migrateSession`), e o whatsmeow faz o mesmo (`MigratePNToLID`, `store.go:258-310`), por isso o `lid-mapping` precisa ir junto.

### 3.4 SenderKeyRecord

Baileys (`baileys/lib/Signal/Group/sender-key-record.js`, `sender-key-state.js`): o valor é `Buffer` de JSON UTF-8 de `[{senderKeyId, senderChainKey{iteration, seed}, senderSigningKey{public, private}, senderMessageKeys[{iteration, seed}]}]`, com bytes em BufferJSON (`data` como array de números). Ordem: o **mais novo no fim** (`push` + `shift`, máximo 5).

go-libsignal: `SenderKeyStructure{SenderKeyStates}` com o **mais novo no início** (`AddSenderKeyState` faz prepend; `SenderKeyState()` devolve `[0]`, `groups/state/record/SenderKeyRecord.go:84-120`). **Inverter a ordem.**

| Go `SenderKeyStateStructure` | Baileys | transformação |
|---|---|---|
| `KeyID` | `senderKeyId` | uint32 |
| `SenderChainKey.Iteration` | `senderChainKey.iteration` | — |
| `SenderChainKey.ChainKey` | `senderChainKey.seed` | 32 (mesma semântica: o Baileys é port do Java, `sender-chain-key.js`) |
| `SigningKeyPublic` | `senderSigningKey.public` | 33 com `0x05`; se vier 32, prefixar `0x05` (o Baileys faz isso em `getSigningKeyPublic`). `DecodePoint` exige o prefixo. |
| `SigningKeyPrivate` | `senderSigningKey.private` | 32 para a nossa; vazio para as recebidas (o Go cria uma privada zerada, inofensiva) |
| `Keys[]` | `senderMessageKeys[]` | para cada `{iteration, seed}`: `ratchet.NewSenderMessageKey(iteration, seed)` para preencher `IV` e `CipherKey` (`HKDF(seed, nil, "WhisperGroup", 48)`: `IV=[0:16]`, `CipherKey=[16:48]`, `groups/ratchet/SenderMessageKey.go`). O Baileys deriva os mesmos bytes (`sender-message-key.js`). Máximo 2000. |

Endereço: Baileys `"<grupo>::<user>[_<domain>]::<device>"` (`sender-key-name.js:serialize`). whatsmeow grava `chat_id = groupID` e `sender_id = SignalAddress.String()` = `"<user>[_<agent>]:<device>"` (`store/signal.go`, `StoreSenderKey`). Ex.: `120363...@g.us::125778553495594_1::36` → `chat_id = 120363...@g.us`, `sender_id = 125778553495594_1:36`. Usar `PutSenderKey`.

Conclusão: **conversão 1:1, sem perda**. No HM: 3 registros, um deles com 4 estados e 290 chaves de mensagem guardadas.

A nossa própria sender key (sender = nosso LID com device) pode ser convertida igual, mas é dispensável: o whatsmeow usa sempre `NewSenderKeyName(grupo, ownLID.SignalAddress())` (`send.go:781`) e manda o SKDM junto para todos os aparelhos do grupo em todo envio (`send.go:782-806`).

## 4. Veredito por classe e o que acontece se pular

**MUST (o aparelho não funciona sem):**

- Noise key: é a chave estática do handshake Noise; o servidor conhece a pública registrada no pareamento. Chave errada ⇒ handshake/login recusado e o servidor trata como aparelho inválido.
- Identity key + signed pre-key + registration id: o `ADVSignedDeviceIdentity` amarra a identity pública (`accountSignature` assina `details ‖ identityPub`); o servidor e os contatos verificam. Errar ⇒ mensagens não decifram e o servidor pode desconectar o aparelho.
- Account/ADV (`details`, `accountSignature`, `accountSignatureKey`, `deviceSignature`): vai como `device-identity` em todo `pkmsg` (`send.go:1275-1284`, `retry.go:524`). Errado ⇒ os destinatários rejeitam as mensagens.
- JID com device (`me.id`): é o `username`/`device` do login. Errado ⇒ outro aparelho ou login recusado.

**SHOULD (funciona, mas com falhas iniciais que se recuperam):**

- Pre-keys: se faltarem, todo `pkmsg` de contato que pegou uma pre-key nossa do servidor falha (`LoadPreKey` devolve nil, `store/signal.go`), o whatsmeow manda retry receipt (`message.go:414-431` → `retry.go:472`) com um bundle novo, e o remetente refaz a sessão. Além disso o upload de 50 pre-keys com ids 1..50 reaproveita ids do Baileys (2.2).
- Sessões: primeira mensagem `msg` (não `pkmsg`) de cada contato com sessão existente ⇒ "no session" ⇒ retry receipt ⇒ o celular do contato reenvia como `pkmsg`. No envio, sem sessão o whatsmeow busca o bundle e manda `pkmsg` (custo: uma ida ao servidor por aparelho). Efeito visível: atraso ou "Aguardando mensagem" no primeiro contato após a troca.
- Sender keys recebidas: primeira mensagem de grupo (`skmsg`) de cada membro ⇒ `ErrNoSenderKeyForUser` ⇒ retry receipt com `isUnavailable` (`message.go:419`) ⇒ o remetente reenvia com SKDM.
- Mapa LID: sem ele, envio para `@s.whatsapp.net` não é traduzido para o LID e não acha as sessões convertidas (que estão em LID), caindo no caminho "sem sessão". O whatsmeow reaprende pelos atributos `sender_pn`/`lid` das mensagens e usync.
- App-state sync keys: sem elas, `DecodePatches` falha com `ErrKeyNotFound` e o whatsmeow pede as chaves ao celular (`appstate.go:163-166`, `requestMissingAppStateKeys`); o celular responde com `APP_STATE_SYNC_KEY_SHARE` (`message.go:829-856`), que dispara nova busca.
- App-state versions: converter só com o hash verificado (2.6). Se pular, a próxima notificação `server_sync` (`notification.go:79`) faz snapshot completo da coleção.
- Identity keys: sem elas o whatsmeow confia na primeira chave recebida; risco mínimo.

**CAN skip:** `device-list`, sender key própria, tctoken (convém converter), `processedHistoryMessages`, `routingInfo`, `lastPropHash`, `accountSyncCounter`, `pairingEphemeralKeyPair`, `myAppStateKeyId`.

## 5. Riscos

O que pode derrubar ou "deslogar":

1. **Os dois clientes vivos ao mesmo tempo.** Baileys e whatsmeow com a mesma noise key ⇒ o servidor derruba um com `440 conflict/replaced` em loop (já aconteceu no HM em 2026-09-28 com um backend órfão). O Node precisa estar parado e sem auto-start para a conexão durante e depois da conversão.
2. **Chaves trocadas/truncadas no device** (noise, identity, signed pre-key, ADV). Validar antes de gravar: pública derivada da privada = pública guardada (noise, identity, spk); `Curve25519.Verify(identityPub, 0x05‖spkPub, signature)`; `Verify(accountSignatureKey, prefixo‖details‖identityPub, accountSignature)` como o whatsmeow faz no pareamento (`verifyAccountSignature`, `pair.go:192`).
3. **JID sem device ou com device errado** ⇒ login como outro aparelho.
4. **Logout pelo gateway**: `POST /sessions/{id}/logout` desvincula o aparelho de vez (para os dois). No teste, só usar `disconnect`.
5. **Registration id diferente** não desloga, mas os contatos passam a ver identidade/sessão inconsistente; manter igual.

O que é recuperável sozinho: sessões, sender keys, pre-keys (com retry receipts), app state (pedido de chaves/snapshot), LID map, identity keys. Mensagens enviadas pelo Baileys antes da troca não estão no `retry_buffer` do whatsmeow; um retry receipt de contato para uma delas não é atendido (só afeta mensagens recém-enviadas no minuto da troca).

Rollback: parar o gateway com `disconnect` (sem logout) e religar o Node. O Baileys continua com as próprias chaves no banco (o conversor só lê), mas as sessões que o whatsmeow avançou nesse meio tempo divergem e se recuperam por retry receipt. Pre-keys consumidas pelo whatsmeow continuam no `BaileysKeys` (inofensivo).

Incertezas:

- Não conferi no código do servidor (inacessível) se ele compara `DeviceProps`/`UserAgent` do login com os do pareamento. O whatsmeow do gateway declara `Os = "Wazzy"` e `PlatformType = CHROME` (`cmd/gateway/main.go:33-34`), mas `DeviceProps` só vai no registro; no login vão `UserAgent`/`WebInfo`. O nome em "Aparelhos conectados" deve continuar o do Baileys.
- O formato de `me.lid` com device (`xxx:NN@lid`) é o mesmo nos dois lados pelo código; se o servidor mandar outro no `connect success`, o whatsmeow só substitui e loga um aviso (`connectionevents.go:171-175`).
- `sender_timestamp` do tctoken: assumi unix em segundos (10 dígitos no HM).

## 6. Teste mínimo no HM

Conexão: a única Baileys do HM, `Whatsapps.id = 3` (status `CONNECTED`). No gateway usar `connection_id = 3` (não colide com a sessão de teste `9001`). Atenção: é um número real em uso no HM; se o device for gravado errado, pode ser preciso ler o QR de novo.

1. Backup (fora do Git): `pg_dump -t '"Whatsapps"' -t '"BaileysKeys"'` (ou `COPY` da linha 3 e das chaves do `whatsappId = 3`) para `~/Projetos/weconex/backups/`.
2. Parar o Node: `preview_stop` do servidor "backend" (porta 3001; `.claude/launch.json` em `~/Projetos/weconex`). Conferir com `ps aux | grep "dist/server"` que não sobrou processo. Não religar o backend durante o teste (ao subir, ele restaura as conexões `CONNECTED` com o Baileys).
3. Rodar o conversor em modo `--dry-run` (sem gravar), imprimindo contagens por classe e o resultado das validações da seção 5 item 2, sem chaves.
4. Rodar de verdade, em transação única. Conferir:
   - `SELECT jid, lid, registration_id, length(noise_key), platform, push_name FROM whatsmeow.whatsmeow_device WHERE jid = '<me.id>'`
   - contagens: `whatsmeow_pre_keys` = 801 (uploaded = true), `whatsmeow_sessions` = 14, `whatsmeow_sender_keys` = 3, `whatsmeow_identity_keys` = 11 + 1, `whatsmeow_app_state_sync_keys` = 9, `whatsmeow_app_state_version` = 5 (ou menos, se o hash não bateu), `whatsmeow_lid_map` ≥ 196, `whatsmeow_privacy_tokens` = 5
   - `SELECT * FROM whatsmeow.gateway_sessions WHERE connection_id = 3`
   - Um teste Go no conversor que recarrega cada sessão com `record.NewSessionFromBytes` e cada sender key com `groupRecord.NewSenderKeyFromBytes` sem erro.
5. Subir o gateway (`docker compose -f docker-compose.hm.yml up -d --build` no `weconex-api-meow`) e `curl -X POST -H 'Authorization: Bearer hm-gateway-token' localhost:8090/sessions/3/connect` (cabeçalho conforme o README do gateway).
6. Verificar:
   - Log `Successfully authenticated` e `GET /sessions/3` = `connected` com `me` igual a `me.id`, **sem** evento `qr` no stream `wa:events:3`.
   - No celular, "Aparelhos conectados" continua com o mesmo aparelho (nenhum novo).
   - Receber uma mensagem de um contato que já tinha sessão (um dos 14): chega como `message` e o log não mostra `Error decrypting message` nem envio de retry receipt.
   - Enviar `POST /sessions/3/messages` para esse contato: chega, e o log não mostra busca de pre-key bundle para ele (sessão existente reaproveitada).
   - Mensagem no grupo `120363428555820255@g.us` vinda do remetente convertido: decifra sem retry.
   - Arquivar/fixar uma conversa no celular: sem `AppStateSyncError` no log.
   - Contato novo (sem sessão): envio e recebimento funcionam via `pkmsg`.
7. Encerrar com `docker compose -f docker-compose.hm.yml stop gateway` ou `POST /sessions/3/disconnect`. Nunca `logout`. Para voltar ao Baileys: gateway parado, `preview_start` do "backend".
