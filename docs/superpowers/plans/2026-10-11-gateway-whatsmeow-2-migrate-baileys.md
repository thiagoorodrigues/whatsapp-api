# Gateway whatsmeow — Plano 2: conversão das sessões Baileys (`migrate-baileys`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um comando `migrate-baileys` no gateway que lê uma conexão Baileys já pareada no Postgres do Wazzy (`Whatsapps.session` + `BaileysKeys`) e grava o store do whatsmeow (schema `whatsmeow`) e `gateway_sessions`, para o mesmo aparelho vinculado continuar funcionando sem ler o QR.

**Architecture:** Três camadas. `internal/baileys` só lê e decodifica o formato do Baileys (BufferJSON, creds, linhas de `BaileysKeys`), sem banco. `internal/migrate` converte para estruturas do whatsmeow/libsignal (puro, testável) e valida as assinaturas; um `Writer` grava usando a API do sqlstore. `cmd/migrate-baileys` é o CLI (`--connection`, `--dry-run`, `--replace`). A correção da conversão de sessões e sender keys é provada por fixtures geradas com a própria libsignal-node do Baileys: o Go converte o registro e decifra uma mensagem real cifrada pelo Node.

**Tech Stack:** Go 1.26, whatsmeow `c386243a72ba`, `go.mau.fi/libsignal v0.2.2`, `lib/pq`; Node 24 com `@whiskeysockets/baileys` 7.0.0-rc14 (só para gerar fixtures, a partir de `~/Projetos/weconex/whatsapp-api/node_modules`).

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-10-gateway-whatsmeow-design.md` (seção "Conversão das sessões") e o mapeamento campo a campo `whatsapp-api/docs/superpowers/specs/2026-10-11-migrate-baileys-mapping.md` — **ler os dois antes de qualquer tarefa; o mapeamento é a fonte de verdade das transformações** (seções citadas como §).

## Global Constraints

- Repo: `/Users/thiagorodrigues/Projetos/weconex/weconex-api-meow` (módulo Go `whatsmeowapi`), branch `feat/migrate-baileys`. Nunca push sem o usuário pedir; nunca na `main`.
- Go só pelo Makefile (`make test`, `make vet`, `make tidy`) — container `golang:1.26-alpine`. Fonte do whatsmeow/libsignal: volume `wazzy-gomod` (`/go/pkg/mod/go.mau.fi/whatsmeow@v0.0.0-20261007111105-c386243a72ba/`, `/go/pkg/mod/go.mau.fi/libsignal@v0.2.2/`).
- **O conversor só lê o lado Baileys.** Nunca escreve em `"Whatsapps"` nem `"BaileysKeys"`.
- Tabelas do Baileys estão no schema `public` (nomes com aspas: `public."Whatsapps"`, `public."BaileysKeys"`); o DSN do gateway tem `search_path=whatsmeow`, então qualificar sempre `public.`.
- Chave privada, semente, root key ou chain key **nunca** em log, saída de terminal, erro ou fixture versionada com dados reais. Fixtures só com chaves geradas no teste. Saída do `--dry-run` = contagens e resultados de validação.
- Sem device válido (assinaturas conferidas, §5 item 2) nada é gravado.
- Device já existente no store para o mesmo JID → recusar, a menos que `--replace` (que apaga o device antes com `Store.Delete`).
- Endereço Signal: trocar o **último** `.` por `:` (§3.3). Chaves Curve25519 nas tabelas do whatsmeow: 32 bytes sem `0x05`; dentro de sessões/sender keys: 33 bytes com `0x05` (§2.1).
- Comentários e commits em pt-BR, identificadores em inglês; commits com trailer `Co-Authored-By:` do modelo que escreveu.
- Nunca `docker compose ... --remove-orphans`; nunca parar/remover containers `whatsapp-api-*`.

## Review Focus

1. **Registro de sessão sem entrada aberta, ou entrada sem cadeia de envio / com campo de chave vazio** — pular a entrada com log de contagem (o Go dá panic com campo vazio). Teste na Task 4.
2. **Pre-key de maior id já consumida** (`MAX(key_id) < nextPreKeyId-1`) — inserir a pre-key "trava" com id `nextPreKeyId-1`, senão o whatsmeow reaproveita ids publicados. Teste na Task 3.
3. **Hash de app-state que não bate** — pular só aquela coleção (versão 0 ⇒ snapshot), nunca gravar estado inconsistente. Teste na Task 6.
4. **BufferJSON nos três formatos** (`data` base64, `data` array de números, objeto `{"0":..}`) e `account.*` como string base64 ou Buffer. Teste na Task 2.
5. **Rodar duas vezes** — a segunda sem `--replace` recusa sem tocar em nada; com `--replace` reconstrói igual. Teste na Task 7.

---

## File Structure

```
internal/baileys/bufferjson.go    decodifica Buffer nos 3 formatos; base64 ou Buffer
internal/baileys/creds.go         struct Creds a partir de Whatsapps.session
internal/baileys/keys.go          linhas de BaileysKeys agrupadas por tipo (Source)
internal/baileys/address.go       endereço Signal Baileys → whatsmeow
internal/migrate/device.go        Creds → *store.Device + validação de assinaturas
internal/migrate/prekeys.go       pre-keys + trava do próximo id
internal/migrate/session.go       SessionRecord libsignal-node → libsignal Go
internal/migrate/senderkey.go     SenderKeyRecord Baileys → libsignal Go
internal/migrate/appstate.go      sync keys, versões (LTHash), privacy tokens, LID map, identities
internal/migrate/plan.go          Plan = tudo convertido + contagens; Build(src) (Plan, error)
internal/migrate/writer.go        grava o Plan no sqlstore + gateway_sessions
cmd/migrate-baileys/main.go       CLI
testdata/fixtures/gen.js          gera fixtures com a libsignal-node do Baileys (rodar à mão)
testdata/fixtures/*.json          fixtures geradas (chaves descartáveis)
```

---

### Task 1: Fixtures da libsignal-node (sessão 1:1 e sender key)

Gera, com a **mesma** libsignal que o Baileys usa, registros reais e mensagens cifradas que o Go terá de decifrar depois da conversão. Sem isso não há como provar a conversão das sessões.

**Files:**
- Create: `testdata/fixtures/gen.js`, `testdata/fixtures/session.json`, `testdata/fixtures/senderkey.json`, `testdata/fixtures/README.md`

**Interfaces:**
- Produces: `session.json` = `{ bobRecord: <SessionRecord.serialize() de Bob, objeto>, bobIdentity: {pub33, priv32}, bobRegistrationId, aliceIdentityPub33, aliceRegistrationId, messages: [{type: 1|3, body: base64, plaintext: string}] , outOfOrder: {type, body, plaintext} }` — `messages` são cifradas por Alice **depois** do estado salvo em `bobRecord` (Bob já decifrou o pkmsg inicial e respondeu uma vez, para haver ratchet nos dois sentidos); `outOfOrder` é uma mensagem de Alice cuja chave ficou guardada em `messageKeys` (Alice cifra M1 e M2, Bob decifra só M2 antes de salvar → M1 fica pendente).
  `senderkey.json` = `{ group: "120363000000000001@g.us", sender: "111111111111111_1.3", bobRecord: <SenderKeyRecord serializado como o Baileys grava (JSON de array de estados, bytes em BufferJSON {type:"Buffer",data:[...]})>, messages: [{body: base64 skmsg, plaintext}], skipped: {body, plaintext} }` — idem: uma mensagem pulada para haver `senderMessageKeys`.
- Todos os valores são de chaves geradas no script (descartáveis).

- [ ] **Step 1: Ler a API real** em `/Users/thiagorodrigues/Projetos/weconex/whatsapp-api/node_modules/@whiskeysockets/baileys/node_modules/libsignal/src/` (`keyhelper.js`, `session_builder.js`, `session_cipher.js`, `session_record.js`, `protocol_address.js`) e `@whiskeysockets/baileys/lib/Signal/Group/` (`group-session-builder.js`, `group_cipher.js`, `sender-key-name.js`, `sender-key-record.js`, `sender-key-distribution-message.js`). Anotar no README das fixtures as assinaturas usadas.

- [ ] **Step 2: Escrever `gen.js`**

Esqueleto (ajustar nomes conforme o Step 1; a lógica é obrigatória):

```js
// Gera fixtures para os testes do migrate-baileys com a libsignal do Baileys.
// Rodar: node testdata/fixtures/gen.js (a partir da raiz do repo). Chaves descartáveis.
const path = require("path");
const fs = require("fs");
const base = "/Users/thiagorodrigues/Projetos/weconex/whatsapp-api/node_modules/@whiskeysockets/baileys";
const libsignal = require(path.join(base, "node_modules/libsignal"));
const G = require(path.join(base, "lib/Signal/Group"));

function store(identity, registrationId) {
  const sessions = {}, preKeys = {}, signed = {};
  return {
    sessions, preKeys, signed,
    getOurIdentity: () => identity,
    getOurRegistrationId: () => registrationId,
    isTrustedIdentity: () => true,
    loadSession: id => sessions[id],
    storeSession: (id, rec) => { sessions[id] = rec; },
    loadPreKey: id => preKeys[id],
    removePreKey: id => { delete preKeys[id]; },
    loadSignedPreKey: id => signed[id],
  };
}

async function sessionFixture() {
  const kh = libsignal.keyhelper;
  const aliceId = kh.generateIdentityKeyPair(), bobId = kh.generateIdentityKeyPair();
  const aliceReg = kh.generateRegistrationId(), bobReg = kh.generateRegistrationId();
  const alice = store(aliceId, aliceReg), bob = store(bobId, bobReg);
  const preKey = kh.generatePreKey(7), signedPreKey = kh.generateSignedPreKey(bobId, 1);
  bob.preKeys[7] = preKey.keyPair; bob.signed[1] = signedPreKey.keyPair;
  const bobAddr = new libsignal.ProtocolAddress("222222222222222_1", 0);
  const aliceAddr = new libsignal.ProtocolAddress("111111111111111_1", 0);
  await new libsignal.SessionBuilder(alice, bobAddr).initOutgoing({
    registrationId: bobReg, identityKey: bobId.pubKey,
    signedPreKey: { keyId: 1, publicKey: signedPreKey.keyPair.pubKey, signature: signedPreKey.signature },
    preKey: { keyId: 7, publicKey: preKey.keyPair.pubKey },
  });
  const aCipher = new libsignal.SessionCipher(alice, bobAddr), bCipher = new libsignal.SessionCipher(bob, aliceAddr);
  const m0 = await aCipher.encrypt(Buffer.from("olá bob"));            // pkmsg (type 3)
  await bCipher.decryptPreKeyWhisperMessage(Buffer.from(m0.body, "binary"));
  const r0 = await bCipher.encrypt(Buffer.from("olá alice"));           // Bob responde
  await aCipher.decryptWhisperMessage(Buffer.from(r0.body, "binary"));
  const pending = await aCipher.encrypt(Buffer.from("fora de ordem"));  // M1 (fica pendente)
  const m2 = await aCipher.encrypt(Buffer.from("segunda"));             // M2
  await bCipher.decryptWhisperMessage(Buffer.from(m2.body, "binary"));  // Bob guarda a chave de M1
  const later = await aCipher.encrypt(Buffer.from("depois de salvar")); // cifrada após o estado salvo
  const rec = bob.sessions[aliceAddr.toString()];
  return {
    bobRecord: rec.serialize ? rec.serialize() : rec,
    bobIdentity: { pub33: Buffer.from(bobId.pubKey).toString("base64"), priv32: Buffer.from(bobId.privKey).toString("base64") },
    bobRegistrationId: bobReg,
    aliceIdentityPub33: Buffer.from(aliceId.pubKey).toString("base64"),
    aliceRegistrationId: aliceReg,
    messages: [{ type: later.type, body: Buffer.from(later.body, "binary").toString("base64"), plaintext: "depois de salvar" }],
    outOfOrder: { type: pending.type, body: Buffer.from(pending.body, "binary").toString("base64"), plaintext: "fora de ordem" },
  };
}

async function senderKeyFixture() {
  // Remetente cria a sender key e a distribution message; Bob processa a SKDM,
  // decifra uma mensagem pulando outra (para haver senderMessageKeys) e o
  // registro de Bob é serializado como o Baileys grava no BaileysKeys.
  // Ver lib/Signal/Group para os nomes exatos (GroupSessionBuilder.create/process,
  // GroupCipher.encrypt/decrypt, SenderKeyName, SenderKeyRecord.serialize).
}

(async () => {
  const dir = __dirname;
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify(await sessionFixture(), null, 1));
  fs.writeFileSync(path.join(dir, "senderkey.json"), JSON.stringify(await senderKeyFixture(), null, 1));
  console.log("fixtures geradas");
})();
```

Completar `senderKeyFixture` pelo mesmo padrão (sender e receiver com stores em memória que guardam `SenderKeyRecord` por `SenderKeyName.toString()`; o valor gravado em `bobRecord` deve ser **exatamente** o que o Baileys guarda no `BaileysKeys` para `sender-key`: o JSON do array de estados com bytes no BufferJSON do Baileys — conferir em `lib/Signal/libsignal.js` como o Baileys chama `storeSenderKey` e serializa). Se `pending`/`m2` da sessão saírem como type 3 (pkmsg) por ainda não haver resposta, ajustar a ordem até `messages[0].type === 1`.

- [ ] **Step 3: Gerar e conferir**

Run: `cd /Users/thiagorodrigues/Projetos/weconex/weconex-api-meow && node testdata/fixtures/gen.js`
Expected: `fixtures geradas`; `session.json` com `bobRecord._sessions` contendo 1 entrada aberta, uma cadeia `chainType 2` com `messageKeys` não vazio; `senderkey.json` com `senderMessageKeys` não vazio.

- [ ] **Step 4: README das fixtures** — o que cada arquivo contém, como regerar, e a frase "chaves descartáveis geradas pelo script; nunca colocar dados reais aqui".

- [ ] **Step 5: Commit** `test: fixtures da libsignal-node para o migrate-baileys`.

---

### Task 2: Leitura do formato Baileys (`internal/baileys`)

**Files:**
- Create: `internal/baileys/bufferjson.go`, `creds.go`, `keys.go`, `address.go`, `baileys_test.go`

**Interfaces:**
- Produces:
  - `func DecodeBuffer(v json.RawMessage) ([]byte, error)` — aceita `{"type":"Buffer","data":"<base64>"}`, `{"type":"Buffer","data":[n,...]}`, `{"0":n,"1":n,...}`; erro em qualquer outra coisa.
  - `func DecodeBytes(v json.RawMessage) ([]byte, error)` — string base64 **ou** qualquer formato de `DecodeBuffer`.
  - `type KeyPair struct{ Private, Public []byte }`
  - `type Creds struct{ NoiseKey, SignedIdentityKey KeyPair; SignedPreKey struct{ KeyPair KeyPair; KeyID uint32; Signature []byte }; RegistrationID uint32; AdvSecretKey []byte; Account struct{ Details, AccountSignatureKey, AccountSignature, DeviceSignature []byte }; MeID, MeLID, MeName, Platform string; NextPreKeyID, FirstUnuploadedPreKeyID uint32; SignalIdentityKey []byte /* signalIdentities[0].identifierKey, 33 */ }`
  - `func ParseCreds(session string) (*Creds, error)` — `session` é o texto de `Whatsapps.session` (`{"creds":{...}}` ou o objeto creds direto; aceitar os dois).
  - `type Row struct{ Type, KeyID string; Value json.RawMessage }`
  - `type Source struct{ ConnectionID int; Creds *Creds; Rows map[string][]Row }` (agrupado por `Type`)
  - `func Load(ctx context.Context, db *sql.DB, connectionID int) (*Source, error)` — `SELECT session FROM public."Whatsapps" WHERE id=$1` e `SELECT type, "keyId", value FROM public."BaileysKeys" WHERE "whatsappId"=$1` (conferir os nomes de coluna na migration `20260929100000-create-baileys-keys` do repo `whatsapp-api`); erro claro se `session` vazio.
  - `func SignalAddress(baileysID string) (string, error)` — troca o último `.` por `:`; erro se não houver `.`.

- [ ] **Step 1: Testes (falham)** — cobrir: os 3 formatos de Buffer + erro para número/string em `DecodeBuffer`; `DecodeBytes` com base64 e com Buffer; `ParseCreds` com um creds sintético contendo **todos** os campos da tabela §1.2 (chaves geradas no teste com `keys.NewKeyPair()`; `account.*` como string base64 e, num segundo caso, como Buffer; envelope `{"creds":...}` e objeto direto); `SignalAddress("125778553495594_1.36") == "125778553495594_1:36"`, `"5511999999999.0" → "5511999999999:0"`, erro para `"semponto"`. Um teste de `Load` não é necessário (é só SQL); fica coberto no HM (Task 8).

- [ ] **Step 2: Implementar** seguindo §1.1–§1.2. Rodar `make test` → PASS.

- [ ] **Step 3: Commit** `feat: leitura do formato do Baileys (BufferJSON, creds, chaves)`.

---

### Task 3: Device e pre-keys (MUST)

**Files:**
- Create: `internal/migrate/device.go`, `internal/migrate/prekeys.go`, `internal/migrate/device_test.go`

**Interfaces:**
- Consumes: `baileys.Creds`, `baileys.Row`.
- Produces:
  - `func BuildDevice(c *baileys.Creds) (*store.Device, error)` — preenche `ID` (`ParseJID(MeID)`, exigir `Device > 0`), `LID`, `RegistrationID`, `NoiseKey`/`IdentityKey` (`keys.NewKeyPairFromPrivateKey`), `SignedPreKey` (`&keys.PreKey{KeyPair: ..., KeyID: ..., Signature: &[64]byte}`), `AdvSecretKey`, `Account` (`&waAdv.ADVSignedDeviceIdentity{Details, AccountSignatureKey, AccountSignature, DeviceSignature}`; `AccountSignatureKey` vazio → `SignalIdentityKey[1:]`), `Platform`, `PushName` (§2.1). **Valida antes de devolver** (§5 item 2): pública derivada == pública guardada (noise, identity, spk); `ecc.VerifySignature(identityPub, 0x05‖spkPub, signature)`; assinatura da conta como `verifyAccountSignature` do whatsmeow (`pair.go`) — copiar a lógica (prefixo, mensagem) do fonte pinado. Qualquer falha → erro, sem device.
  - `type PreKey struct{ ID uint32; Private [32]byte; Uploaded bool }`
  - `func BuildPreKeys(rows []baileys.Row, c *baileys.Creds) ([]PreKey, error)` — `Uploaded = id < FirstUnuploadedPreKeyID`; se `max(id) < NextPreKeyID-1`, acrescenta a trava `{ID: NextPreKeyID-1, Private: aleatória, Uploaded: true}` (§2.2). Rejeita id ≥ 16777216.

- [ ] **Step 1: Testes (falham)** — device sintético válido (gerar noise/identity/spk com `keys.NewKeyPair()`, assinar spk com a identity via `ecc.CalculateSignature`, e gerar uma conta ADV válida assinando com uma "chave da conta" como o celular faz — reproduzir a mensagem que `verifyAccountSignature` confere); casos de erro: pública que não bate, assinatura de spk inválida, assinatura da conta inválida, `me.id` sem device. Pre-keys: `uploaded` conforme `FirstUnuploadedPreKeyID`; trava criada quando a maior foi consumida; sem trava quando `max == NextPreKeyID-1`.

- [ ] **Step 2: Implementar**, `make test` → PASS.

- [ ] **Step 3: Commit** `feat: conversão do device e das pre-keys com validação das assinaturas`.

---

### Task 4: Sessões 1:1 (libsignal-node → libsignal Go)

**Files:**
- Create: `internal/migrate/session.go`, `internal/migrate/session_test.go`

**Interfaces:**
- Consumes: `baileys.Row` (`type=session`), `baileys.SignalAddress`, fixtures da Task 1.
- Produces:
  - `type Session struct{ Address string; Record []byte /* bytes prontos para PutSession */ }`
  - `func BuildSession(row baileys.Row, localIdentityPub33 []byte, localRegistrationID uint32) (*Session, bool /*ok*/, string /*motivo do pulo*/, error)`
  - Regras de §3.2: entrada aberta (`indexInfo.closed == -1`) → `SessionState`; fechadas → `PreviousStates` por `indexInfo.used` desc, máx 40; sem aberta → pular ("sem sessão aberta"); entrada sem cadeia `chainType 1` para `ephemeralKeyPair.pubKey` ou com chave vazia → pular só a entrada (se for a aberta, pular o registro). `ChainKey.Index = counter + 1`; `MessageKeys` derivadas com `kdf.DeriveSecrets(seed, nil, []byte("WhisperMessageKeys"), 80)` (CipherKey `[0:32]`, MacKey `[32:64]`, IV `[64:80]`); cadeias de recebimento fechadas sem `messageKeys` descartadas, com chaves mantidas com `Key=nil`; máximo 5 cadeias de recebimento (as últimas na ordem de inserção, garantindo a de `lastRemoteEphemeralKey`); `PreviousCounter = max(0, v)`; `SessionVersion = 3`; `PendingPreKey` com `optional.NewOptionalUint32`/`NewEmptyUint32`.
  - Montar com os tipos `record.StateStructure`/`record.ChainStructure`/`chain.KeyStructure`/`message.KeysStructure`/`record.PendingPreKeyStructure` e **validar** com `record.NewSessionFromStructure(s, ser.Session, ser.State)` + `.Serialize()` (com `ser := store.SignalProtobufSerializer` do whatsmeow). Recuperar panic da lib (`defer recover`) e tratar como "pular com motivo".

- [ ] **Step 1: Teste ponta a ponta (falha)** — com `testdata/fixtures/session.json`: montar `Row{Type:"session", KeyID:"111111111111111_1.0", Value: bobRecord}`, chamar `BuildSession` com a identity de Bob; criar um `SessionCipher` do go-libsignal sobre um store em memória que devolve esse registro para o endereço de Alice (implementar o store mínimo no teste, ou usar o `store.Device` com sqlstore em SQLite **não** — manter em memória), e:
  - decifrar `messages[0]` (type 1 = `protocol.NewSignalMessageFromBytes`) → plaintext `"depois de salvar"`;
  - decifrar `outOfOrder` → `"fora de ordem"` (prova as `MessageKeys` derivadas);
  - cifrar uma resposta com o estado convertido e decifrar de volta com um segundo `SessionCipher` montado a partir do **registro de Alice convertido** — se a fixture não trouxer o de Alice, acrescentar `aliceRecord` à Task 1 (Step 2) e regerar.
  Casos de pulo: registro sem entrada aberta (editar a fixture em memória: `closed` ≠ -1) → `ok=false`; entrada aberta sem cadeia de envio → `ok=false`, sem panic.

- [ ] **Step 2: Implementar**, `make test` → PASS.

- [ ] **Step 3: Commit** `feat: conversão das sessões 1:1 da libsignal-node para o whatsmeow`.

---

### Task 5: Sender keys de grupo

**Files:**
- Create: `internal/migrate/senderkey.go`, `internal/migrate/senderkey_test.go`

**Interfaces:**
- Consumes: `baileys.Row` (`type=sender-key`), fixture `senderkey.json`.
- Produces:
  - `type SenderKey struct{ Group, Sender string; Record []byte }`
  - `func SenderKeyAddress(keyID string) (group, sender string, err error)` — `"<grupo>::<user>[_<domain>]::<device>"` → `("<grupo>", "<user>[_<domain>]:<device>")` (§3.4).
  - `func BuildSenderKey(row baileys.Row, ownSender string) (*SenderKey, bool, string, error)` — o `value` é Buffer cujo conteúdo é JSON UTF-8 do array de estados (bytes internos em BufferJSON com `data` numérico); **inverter a ordem**; `SigningKeyPublic` com `0x05` (prefixar se vier 32); `Keys` via `ratchet.NewSenderMessageKey(iteration, seed)`; máx 2000; montar `groupRecord.SenderKeyStructure` e validar com `groupRecord.NewSenderKeyFromStruct(...)` + `.Serialize()` (serializadores do `store.SignalProtobufSerializer`). Sender igual a `ownSender` (nosso LID com device) → pular ("própria, o whatsmeow recria").

- [ ] **Step 1: Teste ponta a ponta (falha)** — converter `bobRecord` da fixture; com um `groups.GroupCipher` do go-libsignal sobre um sender-key store em memória, decifrar `messages[0]` e `skipped` → plaintexts esperados. `SenderKeyAddress` com o exemplo de §3.4. Ordem: um registro com 2 estados sintéticos sai invertido.

- [ ] **Step 2: Implementar**, `make test` → PASS.

- [ ] **Step 3: Commit** `feat: conversão das sender keys de grupo`.

---

### Task 6: App state, LID, identities e privacy tokens

**Files:**
- Create: `internal/migrate/appstate.go`, `internal/migrate/appstate_test.go`

**Interfaces:**
- Produces:
  - `func BuildSyncKeys(rows []baileys.Row) ([]SyncKey, error)` com `type SyncKey struct{ ID []byte; Key store.AppStateSyncKey }` — `key_id` base64 → bytes; `KeyData` base64; `Timestamp` int64 da string; `Fingerprint` = `proto.Marshal(&waE2E.AppStateSyncKeyFingerprint{RawID, CurrentIndex, DeviceIndexes})` (§2.5).
  - `func BuildAppStateVersions(rows []baileys.Row) (ok []AppStateVersion, skipped []string, err error)` com `type AppStateVersion struct{ Name string; Version uint64; Hash [128]byte; MACs []store.AppStateMutationMAC }` — verificação obrigatória: `lthash.WAPatchIntegrity.SubtractThenAdd(make([]byte,128), nil, valueMACs)` == `hash`; não bate ou `version == 0` → nome em `skipped` (§2.6). Cada MAC com `Version = version`.
  - `func BuildLIDMappings(rows []baileys.Row, c *baileys.Creds) []store.LIDMapping` — pares de `keyId` sem sufixo (pn → lid), completando com `_reverse`; + par do próprio aparelho; ignorar hosted (§2.4).
  - `func BuildIdentities(rows []baileys.Row, c *baileys.Creds) (map[string][32]byte, error)` — `their_id` via `SignalAddress`; remover `0x05` (rejeitar sem); + `"<lidUser>_1:0"` = `AccountSignatureKey`; se já existir com outro valor → erro (§2.3).
  - `func BuildPrivacyTokens(rows []baileys.Row) ([]store.PrivacyToken, error)` — ignorar `__index`; `time.Unix` (§2.7).

- [ ] **Step 1: Testes (falham)** — fingerprint re-serializado decodifica de volta com os mesmos campos; versão com hash correto (calcular no teste com `lthash` a partir de MACs aleatórios) entra, com hash errado vai para `skipped`; LID: par direto, par só via `_reverse`, hosted ignorado, par próprio presente; identities: remoção do `0x05`, rejeição sem prefixo, linha do aparelho principal, conflito → erro; tokens: `__index` ignorado, `senderTimestamp` ausente.

- [ ] **Step 2: Implementar**, `make test` → PASS.

- [ ] **Step 3: Commit** `feat: conversão de app state, LID, identities e privacy tokens`.

---

### Task 7: Plano, gravação e CLI

**Files:**
- Create: `internal/migrate/plan.go`, `internal/migrate/writer.go`, `internal/migrate/plan_test.go`, `cmd/migrate-baileys/main.go`
- Modify: `Makefile` (alvo `build-migrate`), `README.md` (seção "Converter uma conexão do Baileys")

**Interfaces:**
- Produces:
  - `type Plan struct{ ConnectionID int; Device *store.Device; PreKeys []PreKey; Sessions []Session; SenderKeys []SenderKey; Identities map[string][32]byte; SyncKeys []SyncKey; Versions []AppStateVersion; LIDs []store.LIDMapping; Tokens []store.PrivacyToken; Skipped map[string]int /* motivo → quantidade */; SkippedAppState []string }`
  - `func Build(src *baileys.Source) (*Plan, error)` — chama as funções das Tasks 3–6; falha de device é fatal; pulos viram contagem.
  - `func (p *Plan) Summary() string` — só contagens por classe e motivos (nunca chaves).
  - `type Writer struct{ DB *sql.DB; Container *sqlstore.Container }`
  - `func (w *Writer) Write(ctx context.Context, p *Plan, replace bool) error` — se `Container.GetDevice(ctx, *p.Device.ID)` existir: sem `replace` → erro `ErrDeviceExists`; com `replace` → `Store.Delete`. Depois: `Container.PutDevice`; pre-keys por SQL direto (`INSERT INTO whatsmeow_pre_keys (jid, key_id, key, uploaded)`); `device.Sessions.PutSession`, `device.SenderKeys.PutSenderKey`, `device.Identities.PutIdentity`, `device.AppStateKeys.PutAppStateSyncKey`, `device.AppState.PutAppStateVersion` + `PutAppStateMutationMACs`, `Container.LIDMap.PutManyLIDMappings`, `device.PrivacyTokens.PutPrivacyTokens` (conferir os nomes dos campos de `store.Device` no fonte); por fim `INSERT ... ON CONFLICT (connection_id) DO UPDATE SET jid` em `whatsmeow.gateway_sessions`. Erro no meio → apagar o device (`Store.Delete`) e a linha de `gateway_sessions` antes de devolver o erro (o banco fica como antes).
  - CLI: `migrate-baileys --connection N [--dry-run] [--replace]`, lê `POSTGRES_DSN` (com `config.WithSearchPath`), cria o schema/sqlstore como o gateway (`session.NewManager` não — usar `sqlstore.NewWithDB` + `Upgrade` e o `ensureSchema` exportado ou duplicado mínimo), imprime `Summary()`; `--dry-run` não grava nada.

- [ ] **Step 1: Testes (falham)** — `Build` com um `Source` sintético (creds válido da Task 3 + 1 sessão e 1 sender key das fixtures + pre-keys + app state) → contagens corretas; registro inválido vira `Skipped`, não erro; device inválido → erro. `Summary()` não contém nenhum trecho base64 das chaves do teste (procurar a string base64 das privadas na saída). `Writer` contra o Postgres do HM **em um schema de teste descartável** (`whatsmeow_migrate_test`, criado e apagado pelo teste, pulado com `t.Skip` se `MIGRATE_TEST_DSN` não estiver definido): grava, recarrega cada sessão com `record.NewSessionFromBytes` e cada sender key com `groupRecord.NewSenderKeyFromBytes`; segunda gravação sem `replace` → `ErrDeviceExists` e nada muda; com `replace` → mesmo resultado.

- [ ] **Step 2: Implementar**, `make test` (e `MIGRATE_TEST_DSN=postgres://sweasy:sweasy@host.docker.internal:5435/sweasy?sslmode=disable make test` para o teste de banco — o Makefile precisa repassar a variável ao container com `-e MIGRATE_TEST_DSN`) → PASS.

- [ ] **Step 3: README e commit** `feat: comando migrate-baileys (plano, gravação e dry-run)`.

---

### Task 8: Teste no HM com celular (com o usuário)

**Sem código novo.** Segue §6 do mapeamento, com a conexão escolhida pelo usuário (ver nota abaixo). Nunca `logout` na conexão convertida; só `disconnect`.

- [ ] **Step 1: Preparar a conexão de teste.** Opção recomendada: com o usuário, criar no Wazzy do HM uma conexão nova com o celular de teste (`553191147761`), depois de fazer `POST /sessions/9001/logout` no gateway (o mesmo número não pode estar nos dois). Parear pelo Baileys (QR no Wazzy), trocar mensagens com o `553191673107` (texto, um grupo de teste com os dois) para criar sessões, sender keys e app state.
- [ ] **Step 2: Backup** de `public."Whatsapps"` (linha da conexão) e `public."BaileysKeys"` (`whatsappId` da conexão) em `~/Projetos/weconex/backups/` (fora do Git).
- [ ] **Step 3: Parar o Node** (`preview_stop` do "backend"; `ps aux | grep "dist/server"` vazio).
- [ ] **Step 4: `--dry-run`** e conferir contagens com o inventário (`SELECT type, count(*) FROM public."BaileysKeys" WHERE "whatsappId"=N GROUP BY 1`).
- [ ] **Step 5: Converter** e conferir as tabelas (§6 item 4).
- [ ] **Step 6: Conectar no gateway** (`POST /sessions/N/connect`) e verificar (§6 item 6): `connected` sem evento `qr`; nenhum aparelho novo no celular; mensagem do contato com sessão convertida decifra sem retry; envio para ele sem buscar bundle; mensagem do grupo decifra sem retry; arquivar uma conversa sem `AppStateSyncError`.
- [ ] **Step 7: Encerrar** com `POST /sessions/N/disconnect`; registrar o resultado no README do gateway (seção "Conversão conferida no HM") e commitar.

**Nota:** a conexão Baileys que já existe no HM (`Whatsapps.id = 3`) é um número real em uso; só usar com autorização explícita do usuário.
