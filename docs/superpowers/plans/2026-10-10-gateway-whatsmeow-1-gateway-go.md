# Gateway whatsmeow — Plano 1: gateway Go

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `sweasy/whatsapp-api` (Go) no gateway do Wazzy: sessões whatsmeow identificadas pelo id da conexão, comandos por HTTP com token e todos os eventos publicados em Redis Streams, pronto para rodar no HM sem o Wazzy mudar.

**Architecture:** Pacotes pequenos e testáveis: `events` (envelope + publicação no Redis), `translate` (proto → envelope, puro), `outgoing` (pedido HTTP → proto, puro), `media` (caminhos seguros e pasta de passagem), `session` (whatsmeow: conexão, eventos, comandos) e `httpapi` (rotas, token, erros). `cmd/gateway` monta tudo.

**Tech Stack:** Go 1.26, `go.mau.fi/whatsmeow` (versão de 2026-10-07, `c386243a72ba`), `github.com/redis/go-redis/v9`, `github.com/alicebob/miniredis/v2` (testes), `github.com/lib/pq`, `google.golang.org/protobuf/encoding/protojson`.

**Spec:** `whatsapp-api/docs/superpowers/specs/2026-10-10-gateway-whatsmeow-design.md` (repo do Wazzy). Ler antes de começar.

**Planos irmãos:** Plano 2 = conversão das sessões (`migrate-baileys`); Plano 3 = Wazzy sem Baileys (`WhatsmeowChannel`, consumer, remoção do Baileys, virada). Este plano não toca no repo do Wazzy, exceto pelo próprio documento.

## Global Constraints

- Repo: `/Users/thiagorodrigues/Projetos/sweasy/whatsapp-api`, módulo Go `whatsmeowapi`. Trabalhar na branch `feat/wazzy-gateway`; **nunca dar push na `main`** sem o usuário pedir.
- Não há Go instalado no notebook: todo `go` roda pelo Makefile (`make test`, `make tidy`, `make build`), que usa o container `golang:1.26-alpine`.
- Sessão = `Whatsapps.id` do Wazzy (inteiro). O gateway **não conhece empresa, ticket nem fila**.
- Tabelas do whatsmeow e `gateway_sessions` ficam no schema Postgres **`whatsmeow`** do banco do Wazzy. O gateway nunca lê nem escreve tabelas do Wazzy.
- Eventos: stream `wa:events:{connectionId}`, campo único `e` com o JSON do envelope `{type, connectionId, ts, data}`.
- Todas as respostas HTTP usam o envelope atual `{success, data, error}`.
- Auth: header `Authorization: Bearer $GATEWAY_TOKEN` em todas as rotas, exceto `GET /health`. Sem `GATEWAY_TOKEN` o processo não sobe.
- Mídia: caminhos sempre **relativos a `MEDIA_ROOT`** (`/app/public`); pasta de passagem `MEDIA_ROOT/.gateway/in` (recebidas) e `MEDIA_ROOT/.gateway/out` (Node grava antes de enviar). Caminho que sai de `MEDIA_ROOT` é recusado.
- Container roda como **root** (mesmo dono de arquivos que a api, volume comum).
- Credenciais nunca em arquivo versionado nem em log.
- Comentários e mensagens de commit em português; nomes de código em inglês (padrão do repo do Wazzy).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Remetente em LID sem telefone conhecido** (contato novo que só aparece como `@lid`): `sender.jid` deve vir com o LID (não vazio) e `sender.lid` preenchido, para o Node cair no fallback dele. Teste na Task 3.
2. **Grupo cujo nome não pode ser buscado** (gateway saiu do grupo, timeout): a mensagem é publicada mesmo assim, com `chat.name` vazio. Teste na Task 6 (resolver falhando).
3. **Redis fora do ar por alguns segundos**: `Publish` tenta de novo (3 tentativas) e não derruba o processo nem o handler do whatsmeow. Teste na Task 2.
4. **`path` malicioso ou errado no envio/download** (`../../etc/passwd`, absoluto, arquivo inexistente): 400 com mensagem clara, nada é lido fora de `MEDIA_ROOT`. Teste na Task 4 e Task 5.
5. **Mídia que o WhatsApp não tem mais (404/410/403)**: `POST /media` devolve `data: null` (não erro 500), para o Node gravar a mensagem sem arquivo como faz hoje. Teste na Task 7.

---

## File Structure

```
cmd/gateway/main.go              monta config, banco, redis, manager, http
internal/config/config.go        variáveis de ambiente + validação + search_path
internal/events/envelope.go      tipos do envelope e dos dados de cada evento
internal/events/publisher.go     RedisPublisher (XADD com retentativa)
internal/translate/message.go    events.Message do whatsmeow → Result
internal/translate/body.go       tipo, texto, mídia e contexto do proto
internal/translate/other.go      recibo, presença, chamada, contatos, histórico
internal/translate/raw.go        payload bruto {key, message, ...}
internal/outgoing/address.go     Address → types.JID
internal/outgoing/build.go       SendRequest → *waE2E.Message (upload de mídia)
internal/media/media.go          SafeJoin, pastas de passagem, limpeza
internal/session/store.go        tabela gateway_sessions + schema
internal/session/manager.go      Manager/Session: conectar, restaurar, QR, eventos
internal/session/resolver.go     LID→telefone, nome do grupo (cache), eu
internal/session/commands.go     enviar, apagar, editar, reagir, lida, presença...
internal/httpapi/router.go       rotas (Go 1.22 ServeMux) + auth + erros
internal/httpapi/handlers.go     um handler por rota, contra a interface Service
internal/httputil/response.go    (existente) envelope de resposta
internal/version/version.go      (existente)
Makefile, Dockerfile, .env.example, docker-compose.hm.yml, README.md
```

**Sai:** `cmd/server/`, `http/` (pasta inteira), `whatsapp/` (pasta inteira), `docker-compose.prod.yml`, `docker-compose.yml` (Postgres próprio), `sweasy-whatsmeow-api.postman_collection.json`, tabela `wa_sessions` (não é criada mais).

---

### Task 1: Base nova (branch, Go 1.26, Makefile, config, limpeza)

**Files:**
- Create: `Makefile`, `internal/config/config.go`, `internal/config/config_test.go`, `cmd/gateway/main.go` (versão mínima), `docker-compose.hm.yml`
- Modify: `go.mod`, `go.sum`, `Dockerfile`, `.env.example`, `.dockerignore`
- Delete: `cmd/server/`, `http/`, `whatsapp/`, `docker-compose.prod.yml`, `docker-compose.yml`, `sweasy-whatsmeow-api.postman_collection.json`

**Interfaces:**
- Produces: `config.Config{HTTPPort, PostgresDSN, RedisURL, GatewayToken, LogLevel, MediaRoot string}`, `config.Load() (*config.Config, error)`, `config.WithSearchPath(dsn, schema string) (string, error)`.

- [ ] **Step 1: Branch e limpeza**

```bash
cd /Users/thiagorodrigues/Projetos/sweasy/whatsapp-api
git checkout -b feat/wazzy-gateway
git rm -r -q cmd/server http whatsapp docker-compose.prod.yml docker-compose.yml sweasy-whatsmeow-api.postman_collection.json
```

O `.env` local (não versionado) pode ficar; ele não é lido pelo gateway novo no HM (o compose passa as variáveis).

- [ ] **Step 2: Makefile com Go em container**

`Makefile`:

```makefile
# Não há Go instalado no notebook: tudo roda no container oficial.
GO_IMAGE ?= golang:1.26-alpine
GO = docker run --rm -v "$(CURDIR)":/src -v wazzy-gomod:/go/pkg/mod -v wazzy-gocache:/root/.cache/go-build -w /src -e CGO_ENABLED=0 $(GO_IMAGE) go

.PHONY: test tidy build vet

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

tidy:
	$(GO) mod tidy

build:
	$(GO) build ./...
```

- [ ] **Step 3: go.mod em Go 1.26 com as dependências novas**

Trocar a linha `go 1.24.0` por `go 1.26.0` em `go.mod` e rodar:

```bash
make tidy
docker run --rm -v "$PWD":/src -v wazzy-gomod:/go/pkg/mod -w /src golang:1.26-alpine sh -c 'go get go.mau.fi/whatsmeow@c386243a72ba github.com/redis/go-redis/v9@v9.23.0 github.com/alicebob/miniredis/v2@v2.40.0'
```

(O `make tidy` final acontece no Step 7, quando já houver imports.)

- [ ] **Step 4: Teste da config (falha)**

`internal/config/config_test.go`:

```go
package config

import "testing"

func TestLoadRequiresToken(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN", "")
	t.Setenv("POSTGRES_DSN", "postgres://u:p@db:5432/wazzy?sslmode=disable")
	t.Setenv("REDIS_URL", "redis://redis:6379")
	if _, err := Load(); err == nil {
		t.Fatal("esperava erro sem GATEWAY_TOKEN")
	}
}

func TestLoadDefaultsAndSearchPath(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN", "segredo")
	t.Setenv("POSTGRES_DSN", "postgres://u:p@db:5432/wazzy?sslmode=disable")
	t.Setenv("REDIS_URL", "redis://redis:6379")
	t.Setenv("HTTP_PORT", "")
	t.Setenv("MEDIA_ROOT", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPPort != "8080" || cfg.MediaRoot != "/app/public" || cfg.LogLevel != "INFO" {
		t.Fatalf("defaults errados: %+v", cfg)
	}
	want := "postgres://u:p@db:5432/wazzy?search_path=whatsmeow&sslmode=disable"
	if cfg.PostgresDSN != want {
		t.Fatalf("dsn = %q, quero %q", cfg.PostgresDSN, want)
	}
}

func TestWithSearchPathKeepsExisting(t *testing.T) {
	got, err := WithSearchPath("postgres://u:p@db/wazzy?search_path=outro", "whatsmeow")
	if err != nil {
		t.Fatal(err)
	}
	if got != "postgres://u:p@db/wazzy?search_path=outro" {
		t.Fatalf("não deveria trocar search_path existente: %q", got)
	}
}
```

Run: `make test` → FAIL (`Load` não existe).

- [ ] **Step 5: Implementar a config**

`internal/config/config.go`:

```go
// Package config lê as variáveis de ambiente do gateway.
package config

import (
	"errors"
	"net/url"
	"os"
)

type Config struct {
	HTTPPort     string
	PostgresDSN  string // já com search_path=whatsmeow
	RedisURL     string
	GatewayToken string
	LogLevel     string
	MediaRoot    string
}

// Schema do Postgres onde ficam as tabelas do whatsmeow e gateway_sessions.
const Schema = "whatsmeow"

func Load() (*Config, error) {
	cfg := &Config{
		HTTPPort:     getEnv("HTTP_PORT", "8080"),
		PostgresDSN:  os.Getenv("POSTGRES_DSN"),
		RedisURL:     os.Getenv("REDIS_URL"),
		GatewayToken: os.Getenv("GATEWAY_TOKEN"),
		LogLevel:     getEnv("LOG_LEVEL", "INFO"),
		MediaRoot:    getEnv("MEDIA_ROOT", "/app/public"),
	}
	if cfg.GatewayToken == "" {
		return nil, errors.New("GATEWAY_TOKEN é obrigatório")
	}
	if cfg.PostgresDSN == "" || cfg.RedisURL == "" {
		return nil, errors.New("POSTGRES_DSN e REDIS_URL são obrigatórios")
	}
	dsn, err := WithSearchPath(cfg.PostgresDSN, Schema)
	if err != nil {
		return nil, err
	}
	cfg.PostgresDSN = dsn
	return cfg, nil
}

// WithSearchPath acrescenta search_path ao DSN em formato URL, se ainda não
// houver. O lib/pq repassa parâmetros desconhecidos como parâmetros da sessão.
func WithSearchPath(dsn, schema string) (string, error) {
	u, err := url.Parse(dsn)
	if err != nil {
		return "", errors.New("POSTGRES_DSN inválido (use o formato postgres://...)")
	}
	q := u.Query()
	if q.Get("search_path") == "" {
		q.Set("search_path", schema)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
```

Run: `make test` → PASS.

- [ ] **Step 6: main mínimo (só sobe e responde /health)**

`cmd/gateway/main.go` (será completado na Task 8):

```go
package main

import (
	"log"
	"net/http"

	"whatsmeowapi/internal/config"
	"whatsmeowapi/internal/httputil"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		httputil.WriteSuccess(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	log.Printf("gateway em :%s", cfg.HTTPPort)
	log.Fatal(http.ListenAndServe(":"+cfg.HTTPPort, mux))
}
```

- [ ] **Step 7: Dockerfile, .env.example, .dockerignore e compose do HM**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM golang:1.26-alpine AS build
ARG APP_VERSION=dev
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -ldflags="-s -w -X 'whatsmeowapi/internal/version.Version=${APP_VERSION}'" -o /out/gateway ./cmd/gateway

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /out/gateway ./gateway
ENV HTTP_PORT=8080 LOG_LEVEL=INFO MEDIA_ROOT=/app/public
EXPOSE 8080
# Roda como root de propósito: escreve no mesmo volume da api do Wazzy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD wget -qO- http://localhost:8080/health || exit 1
ENTRYPOINT ["./gateway"]
```

`.env.example`:

```env
HTTP_PORT=8080
LOG_LEVEL=INFO
# Banco do Wazzy; o gateway usa só o schema "whatsmeow" (acrescentado sozinho).
POSTGRES_DSN=postgres://usuario:senha@postgres:5432/wazzy?sslmode=disable
REDIS_URL=redis://redis:6379
# Mesmo valor na api do Wazzy (GATEWAY_TOKEN).
GATEWAY_TOKEN=
# Volume comum com a api do Wazzy.
MEDIA_ROOT=/app/public
```

`.dockerignore`:

```
.git
.env
.vscode
*.md
docker-compose*.yml
```

`docker-compose.hm.yml` (HM deste notebook: Postgres na porta 5435 e Redis na 6379 do host; `public` da api local):

```yaml
# Gateway no HM: usa o Postgres e o Redis do docker-compose do Wazzy
# (portas do host) e a pasta public da api local.
services:
  gateway:
    build: .
    ports:
      - 8090:8080
    environment:
      POSTGRES_DSN: postgres://sweasy:sweasy@host.docker.internal:5435/sweasy?sslmode=disable
      REDIS_URL: redis://host.docker.internal:6379
      GATEWAY_TOKEN: hm-gateway-token
      LOG_LEVEL: INFO
      MEDIA_ROOT: /app/public
    volumes:
      - /Users/thiagorodrigues/Projetos/weconex/whatsapp-api/public:/app/public
    restart: on-failure:3
```

Run: `make tidy && make build && make test` → PASS. Run: `docker compose -f docker-compose.hm.yml up -d --build && sleep 3 && curl -s localhost:8090/health` → `{"success":true,"data":{"status":"ok"},"error":null}`. Depois `docker compose -f docker-compose.hm.yml down`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: base do gateway do Wazzy (Go 1.26, config, Makefile, Docker)

Remove a API antiga (sessões por UUID, webhook, Postgres próprio).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Envelope dos eventos e publicação no Redis

**Files:**
- Create: `internal/events/envelope.go`, `internal/events/publisher.go`, `internal/events/publisher_test.go`

**Interfaces:**
- Produces:
  - constantes `TypeMessage, TypeReceipt, TypeReaction, TypeMessageUpdate, TypePresence, TypeLIDMapping, TypeContacts, TypeGroupUpdate, TypeHistory, TypeCall, TypeConnection` (strings `message, receipt, reaction, message_update, presence, lid_mapping, contacts, group_update, history, call, connection`);
  - `type Envelope struct{Type string; ConnectionID int; TS int64; Data any}`;
  - `func New(typ string, connectionID int, data any) Envelope` (preenche `TS` com `time.Now().UnixMilli()`);
  - tipos de dados `Message, Chat, Sender, Media, Receipt, Reaction, MessageUpdate, Presence, LIDMapping, Contact, Contacts, GroupUpdate, History, Call, Connection` (campos abaixo);
  - `type Publisher interface{ Publish(ctx context.Context, env Envelope) error }`;
  - `func StreamKey(connectionID int) string` → `wa:events:{id}`;
  - `func NewRedisPublisher(rdb *redis.Client) *RedisPublisher`.

- [ ] **Step 1: Tipos do envelope**

`internal/events/envelope.go`:

```go
// Package events define o que o gateway publica para o Wazzy: um envelope
// por evento, no stream Redis da conexão (wa:events:{id}).
package events

import (
	"encoding/json"
	"time"
)

const (
	TypeMessage       = "message"
	TypeReceipt       = "receipt"
	TypeReaction      = "reaction"
	TypeMessageUpdate = "message_update"
	TypePresence      = "presence"
	TypeLIDMapping    = "lid_mapping"
	TypeContacts      = "contacts"
	TypeGroupUpdate   = "group_update"
	TypeHistory       = "history"
	TypeCall          = "call"
	TypeConnection    = "connection"
)

type Envelope struct {
	Type         string `json:"type"`
	ConnectionID int    `json:"connectionId"`
	TS           int64  `json:"ts"`
	Data         any    `json:"data"`
}

func New(typ string, connectionID int, data any) Envelope {
	return Envelope{Type: typ, ConnectionID: connectionID, TS: time.Now().UnixMilli(), Data: data}
}

type Chat struct {
	JID     string `json:"jid"`
	IsGroup bool   `json:"isGroup"`
	Name    string `json:"name,omitempty"`
}

// Sender: quem escreveu. Em conversa privada é sempre o contato (mesmo nas
// mensagens que nós enviamos), como o InboundMessage do Wazzy espera.
type Sender struct {
	JID  string `json:"jid"` // JID do telefone quando conhecido; senão o LID
	Name string `json:"name,omitempty"`
	LID  string `json:"lid,omitempty"`
}

type Media struct {
	Mimetype string `json:"mimetype"`
	FileName string `json:"fileName"`
}

type Message struct {
	ID          string          `json:"id"`
	FromMe      bool            `json:"fromMe"`
	History     bool            `json:"history"`
	Timestamp   int64           `json:"timestamp"` // epoch ms
	Chat        Chat            `json:"chat"`
	Sender      Sender          `json:"sender"`
	Kind        string          `json:"kind"`
	ChannelType string          `json:"channelType"`
	Text        string          `json:"text"`
	HasMedia    bool            `json:"hasMedia"`
	Media       *Media          `json:"media,omitempty"`
	QuotedID    string          `json:"quotedId,omitempty"`
	EditOf      string          `json:"editOf,omitempty"`
	Forwarded   bool            `json:"forwarded"`
	Mentions    []string        `json:"mentions"`
	Raw         json.RawMessage `json:"raw"`
}

// Receipt: status = delivered | read | played (o contato) ou read_self |
// played_self (lida por nós em outro aparelho).
type Receipt struct {
	IDs     []string `json:"ids"`
	Chat    string   `json:"chat"`
	Sender  string   `json:"sender"`
	IsGroup bool     `json:"isGroup"`
	Status  string   `json:"status"`
}

type Reaction struct {
	ID     string `json:"id"` // mensagem que recebeu a reação
	Chat   string `json:"chat"`
	Sender string `json:"sender"` // "me" quando fomos nós
	FromMe bool   `json:"fromMe"`
	Emoji  string `json:"emoji"` // vazio = reação removida
	At     int64  `json:"at"`
}

type MessageUpdate struct {
	ID      string `json:"id"`
	Chat    string `json:"chat"`
	Revoked bool   `json:"revoked"`
}

type Presence struct {
	Chat   string `json:"chat"`
	Sender string `json:"sender"`
	State  string `json:"state"` // composing | recording | paused
}

type LIDMapping struct {
	LID string `json:"lid"`
	PN  string `json:"pn"`
}

// Contact segue o SyncedContact do Wazzy (id → jid).
type Contact struct {
	JID    string `json:"jid"`
	LID    string `json:"lid,omitempty"`
	Name   string `json:"name,omitempty"`
	Notify string `json:"notify,omitempty"`
}

type Contacts struct {
	Contacts []Contact `json:"contacts"`
}

type GroupUpdate struct {
	JID string `json:"jid"`
}

type History struct {
	Messages []Message `json:"messages"`
	Contacts []Contact `json:"contacts"`
	Progress int       `json:"progress"`
	Final    bool      `json:"final"`
}

type Call struct {
	Event   string `json:"event"` // offer | terminate
	CallID  string `json:"callId"`
	From    string `json:"from"`
	IsVideo bool   `json:"isVideo"`
	IsGroup bool   `json:"isGroup"`
	TS      int64  `json:"ts"`
}

// Connection: status = qr | pair_code | connected | disconnected | logged_out.
type Connection struct {
	Status string `json:"status"`
	QR     string `json:"qr,omitempty"`
	Code   string `json:"code,omitempty"`
	Me     string `json:"me,omitempty"`
	Reason string `json:"reason,omitempty"`
}
```

- [ ] **Step 2: Teste do publisher (falha)**

`internal/events/publisher_test.go`:

```go
package events

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestPublisher(t *testing.T) (*RedisPublisher, *miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	p := NewRedisPublisher(rdb)
	p.retryDelays = []time.Duration{time.Millisecond, time.Millisecond}
	return p, mr, rdb
}

func TestPublishWritesEnvelopeToConnectionStream(t *testing.T) {
	p, _, rdb := newTestPublisher(t)
	env := New(TypeReceipt, 12, Receipt{IDs: []string{"A"}, Chat: "5511@s.whatsapp.net", Status: "read"})
	if err := p.Publish(context.Background(), env); err != nil {
		t.Fatal(err)
	}
	if StreamKey(12) != "wa:events:12" {
		t.Fatalf("stream key = %s", StreamKey(12))
	}
	msgs, err := rdb.XRange(context.Background(), "wa:events:12", "-", "+").Result()
	if err != nil || len(msgs) != 1 {
		t.Fatalf("esperava 1 entrada, veio %d (%v)", len(msgs), err)
	}
	var got Envelope
	if err := json.Unmarshal([]byte(msgs[0].Values["e"].(string)), &got); err != nil {
		t.Fatal(err)
	}
	if got.Type != "receipt" || got.ConnectionID != 12 || got.TS == 0 {
		t.Fatalf("envelope errado: %+v", got)
	}
}

func TestPublishRetriesThenFails(t *testing.T) {
	p, mr, _ := newTestPublisher(t)
	mr.Close() // Redis fora do ar
	err := p.Publish(context.Background(), New(TypePresence, 1, Presence{}))
	if err == nil {
		t.Fatal("esperava erro com o Redis fora")
	}
}

func TestPublishRecoversWhenRedisComesBack(t *testing.T) {
	p, mr, rdb := newTestPublisher(t)
	addr := mr.Addr()
	mr.Close()
	p.retryDelays = []time.Duration{50 * time.Millisecond, 200 * time.Millisecond}
	go func() {
		time.Sleep(20 * time.Millisecond)
		_ = mr.StartAddr(addr)
	}()
	if err := p.Publish(context.Background(), New(TypePresence, 3, Presence{})); err != nil {
		t.Fatalf("deveria publicar após o Redis voltar: %v", err)
	}
	n, _ := rdb.XLen(context.Background(), "wa:events:3").Result()
	if n != 1 {
		t.Fatalf("esperava 1 evento, veio %d", n)
	}
}
```

Run: `make test` → FAIL (`NewRedisPublisher` não existe).

- [ ] **Step 3: Implementar o publisher**

`internal/events/publisher.go`:

```go
package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Publisher interface {
	Publish(ctx context.Context, env Envelope) error
}

// Eventos guardados por conexão enquanto o Wazzy não lê (aproximado).
const streamMaxLen = 200000

func StreamKey(connectionID int) string { return fmt.Sprintf("wa:events:%d", connectionID) }

type RedisPublisher struct {
	rdb         *redis.Client
	retryDelays []time.Duration
}

func NewRedisPublisher(rdb *redis.Client) *RedisPublisher {
	return &RedisPublisher{rdb: rdb, retryDelays: []time.Duration{200 * time.Millisecond, time.Second, 3 * time.Second}}
}

// Publish grava o envelope no stream da conexão. Tenta de novo algumas vezes
// se o Redis falhar; depois devolve o erro (quem chama só registra no log).
func (p *RedisPublisher) Publish(ctx context.Context, env Envelope) error {
	body, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("envelope %s: %w", env.Type, err)
	}
	args := &redis.XAddArgs{Stream: StreamKey(env.ConnectionID), MaxLen: streamMaxLen, Approx: true, Values: map[string]any{"e": string(body)}}
	err = p.rdb.XAdd(ctx, args).Err()
	for _, delay := range p.retryDelays {
		if err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
		err = p.rdb.XAdd(ctx, args).Err()
	}
	return err
}
```

Run: `make test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/events
git commit -m "feat: envelope dos eventos e publicação em Redis Streams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tradução de mensagens (proto → envelope)

Porta para Go o que `channels/baileys/parse.ts` e `toInbound.ts` fazem hoje no Wazzy, com os mesmos textos (o frontend depende deles).

**Files:**
- Create: `internal/translate/body.go`, `internal/translate/raw.go`, `internal/translate/message.go`, `internal/translate/message_test.go`

**Interfaces:**
- Consumes: tipos de `internal/events` (Task 2).
- Produces:
  - `type Resolver interface { PhoneFor(lid types.JID) types.JID; GroupName(chat types.JID) string; Me() types.JID; MyName() string }` (`PhoneFor` devolve `types.EmptyJID` quando não sabe);
  - `type Result struct { Message *events.Message; Reaction *events.Reaction; Update *events.MessageUpdate; LIDMapping *events.LIDMapping }`;
  - `func FromMessage(evt *wevents.Message, r Resolver) Result` (`wevents` = `go.mau.fi/whatsmeow/types/events`);
  - `func Raw(info types.MessageInfo, msg *waE2E.Message) json.RawMessage`;
  - `func MediaOf(msg *waE2E.Message) (whatsmeow.DownloadableMessage, events.Media, bool)` (usado na Task 7).

Regras (iguais às do Wazzy hoje):

| proto | `channelType` | `kind` | `text` |
|---|---|---|---|
| `Conversation` | `conversation` | text | o texto |
| `ExtendedTextMessage` | `extendedTextMessage` | text | `Text` |
| `ImageMessage` | `imageMessage` | image | `Caption` |
| `VideoMessage` | `videoMessage` | video | `Caption` |
| `AudioMessage` | `audioMessage` | audio | `Áudio` |
| `DocumentMessage` | `documentMessage` | document | `Caption`, senão `Title` |
| `StickerMessage` | `stickerMessage` | sticker | `sticker` |
| `LocationMessage` | `locationMessage` | location | `data:image/png;base64, {thumb} \| https://maps.google.com/maps?q={lat}%2C{lng}&z=17&hl=pt-BR\|{lat}, {lng} ` (vazio sem miniatura) |
| `LiveLocationMessage` | `liveLocationMessage` | location | `Latitude: {lat} - Longitude: {lng}` |
| `ContactMessage` | `contactMessage` | contact | `{numero}/{nome}` do vCard |
| `ContactsArrayMessage` | `contactsArrayMessage` | contacts | os contatos unidos por `_` |
| `ButtonsResponseMessage` | `buttonsResponseMessage` | text | `SelectedButtonID` |
| `ListResponseMessage` | `listResponseMessage` | text | `SingleSelectReply.SelectedRowID` |
| `TemplateButtonReplyMessage` | `templateButtonReplyMessage` | text | `SelectedID` |
| `ProtocolMessage` tipo `MESSAGE_EDIT` | `editedMessage` | text | texto novo; `editOf` = `Key.ID` |
| `ProtocolMessage` tipo `REVOKE` | — | — | vira `Update{Revoked:true}` |
| `ReactionMessage` | — | — | vira `Reaction` |
| qualquer outro, `status@broadcast`, newsletter | — | — | ignorado (Result vazio) |

`mediaInfo`: `fileName` = `DocumentMessage.FileName` ou `{unixms}.{ext}` com `ext` = parte depois de `/` do mimetype, até `;` (`bin` se faltar).

- [ ] **Step 1: Testes (falham)**

`internal/translate/message_test.go`:

```go
package translate

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	wevents "go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

type fakeResolver struct {
	phones map[string]types.JID
	groups map[string]string
}

func (f fakeResolver) PhoneFor(lid types.JID) types.JID {
	if j, ok := f.phones[lid.String()]; ok {
		return j
	}
	return types.EmptyJID
}
func (f fakeResolver) GroupName(chat types.JID) string { return f.groups[chat.String()] }
func (f fakeResolver) Me() types.JID                   { return types.NewJID("5511000000000", types.DefaultUserServer) }
func (f fakeResolver) MyName() string                  { return "Wazzy" }

var (
	contactPN  = types.NewJID("5511999990000", types.DefaultUserServer)
	contactLID = types.NewJID("123456789", types.HiddenUserServer)
	groupJID   = types.NewJID("120363000000000001", types.GroupServer)
	ts         = time.UnixMilli(1760100000000)
)

func dm(msg *waE2E.Message) *wevents.Message {
	return &wevents.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: contactLID, Sender: contactLID, SenderAlt: contactPN},
			ID:            "MSG1", PushName: "Maria", Timestamp: ts,
		},
		Message: msg,
	}
}

func TestTextMessageInDM(t *testing.T) {
	res := FromMessage(dm(&waE2E.Message{Conversation: proto.String("oi")}), fakeResolver{})
	m := res.Message
	if m == nil {
		t.Fatal("esperava mensagem")
	}
	if m.ID != "MSG1" || m.Kind != "text" || m.ChannelType != "conversation" || m.Text != "oi" || m.Timestamp != 1760100000000 {
		t.Fatalf("mensagem errada: %+v", m)
	}
	if m.Chat.JID != "123456789@lid" || m.Chat.IsGroup {
		t.Fatalf("chat errado: %+v", m.Chat)
	}
	if m.Sender.JID != "5511999990000@s.whatsapp.net" || m.Sender.LID != "123456789@lid" || m.Sender.Name != "Maria" {
		t.Fatalf("sender errado: %+v", m.Sender)
	}
	if res.LIDMapping == nil || res.LIDMapping.LID != "123456789@lid" || res.LIDMapping.PN != "5511999990000@s.whatsapp.net" {
		t.Fatalf("esperava lid_mapping, veio %+v", res.LIDMapping)
	}
	var raw map[string]any
	if err := json.Unmarshal(m.Raw, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["key"].(map[string]any)["id"] != "MSG1" || raw["message"].(map[string]any)["conversation"] != "oi" {
		t.Fatalf("raw errado: %s", m.Raw)
	}
}

func TestUnknownLIDKeepsLIDAsSender(t *testing.T) {
	evt := dm(&waE2E.Message{Conversation: proto.String("oi")})
	evt.Info.SenderAlt = types.EmptyJID
	m := FromMessage(evt, fakeResolver{}).Message
	if m.Sender.JID != "123456789@lid" || m.Sender.LID != "123456789@lid" {
		t.Fatalf("sem telefone, sender.jid deve ser o LID: %+v", m.Sender)
	}
}

func TestResolverFillsPhoneForLID(t *testing.T) {
	evt := dm(&waE2E.Message{Conversation: proto.String("oi")})
	evt.Info.SenderAlt = types.EmptyJID
	r := fakeResolver{phones: map[string]types.JID{"123456789@lid": contactPN}}
	if got := FromMessage(evt, r).Message.Sender.JID; got != "5511999990000@s.whatsapp.net" {
		t.Fatalf("sender.jid = %s", got)
	}
}

func TestFromMeInDMUsesContactAsSenderWithDigitsName(t *testing.T) {
	evt := dm(&waE2E.Message{Conversation: proto.String("enviada do celular")})
	evt.Info.IsFromMe = true
	evt.Info.Sender = types.NewJID("5511000000000", types.DefaultUserServer)
	evt.Info.SenderAlt = types.EmptyJID
	evt.Info.RecipientAlt = contactPN
	m := FromMessage(evt, fakeResolver{}).Message
	if !m.FromMe || m.Sender.JID != "5511999990000@s.whatsapp.net" || m.Sender.Name != "5511999990000" {
		t.Fatalf("sender errado: %+v", m.Sender)
	}
}

func TestGroupMessageHasNameMentionsAndQuote(t *testing.T) {
	member := types.NewJID("987", types.HiddenUserServer)
	evt := &wevents.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: groupJID, Sender: member, IsGroup: true},
			ID:            "G1", PushName: "João", Timestamp: ts,
		},
		Message: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String("@ana veja"),
			ContextInfo: &waE2E.ContextInfo{
				StanzaID: proto.String("Q1"), MentionedJID: []string{"555@lid"}, IsForwarded: proto.Bool(true),
			},
		}},
	}
	r := fakeResolver{groups: map[string]string{groupJID.String(): "Equipe"}}
	m := FromMessage(evt, r).Message
	if m.Chat.Name != "Equipe" || !m.Chat.IsGroup || m.QuotedID != "Q1" || !m.Forwarded {
		t.Fatalf("grupo errado: %+v", m)
	}
	if len(m.Mentions) != 1 || m.Mentions[0] != "555@lid" {
		t.Fatalf("menções erradas: %v", m.Mentions)
	}
	if m.Sender.JID != "987@lid" || m.Sender.LID != "987@lid" || m.Sender.Name != "João" {
		t.Fatalf("membro errado: %+v", m.Sender)
	}
}

func TestGroupWithoutNameStillPublished(t *testing.T) {
	evt := &wevents.Message{
		Info:    types.MessageInfo{MessageSource: types.MessageSource{Chat: groupJID, Sender: contactPN, IsGroup: true}, ID: "G2", Timestamp: ts},
		Message: &waE2E.Message{Conversation: proto.String("oi")},
	}
	m := FromMessage(evt, fakeResolver{}).Message
	if m == nil || m.Chat.Name != "" {
		t.Fatalf("deveria publicar sem nome: %+v", m)
	}
}

func TestOwnGroupMessageSenderIsMe(t *testing.T) {
	evt := &wevents.Message{
		Info:    types.MessageInfo{MessageSource: types.MessageSource{Chat: groupJID, Sender: types.NewJID("5511000000000", types.DefaultUserServer), IsGroup: true, IsFromMe: true}, ID: "G3", Timestamp: ts},
		Message: &waE2E.Message{Conversation: proto.String("oi")},
	}
	m := FromMessage(evt, fakeResolver{}).Message
	if m.Sender.JID != "5511000000000@s.whatsapp.net" || m.Sender.Name != "Wazzy" {
		t.Fatalf("sender errado: %+v", m.Sender)
	}
}

func TestMediaKinds(t *testing.T) {
	cases := []struct {
		msg         *waE2E.Message
		kind, ctype string
		text        string
		file        string
	}{
		{&waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String("foto"), Mimetype: proto.String("image/jpeg")}}, "image", "imageMessage", "foto", ".jpeg"},
		{&waE2E.Message{VideoMessage: &waE2E.VideoMessage{Mimetype: proto.String("video/mp4")}}, "video", "videoMessage", "", ".mp4"},
		{&waE2E.Message{AudioMessage: &waE2E.AudioMessage{Mimetype: proto.String("audio/ogg; codecs=opus"), PTT: proto.Bool(true)}}, "audio", "audioMessage", "Áudio", ".ogg"},
		{&waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Title: proto.String("contrato"), FileName: proto.String("contrato.pdf"), Mimetype: proto.String("application/pdf")}}, "document", "documentMessage", "contrato", "contrato.pdf"},
		{&waE2E.Message{StickerMessage: &waE2E.StickerMessage{Mimetype: proto.String("image/webp")}}, "sticker", "stickerMessage", "sticker", ".webp"},
	}
	for _, c := range cases {
		m := FromMessage(dm(c.msg), fakeResolver{}).Message
		if m.Kind != c.kind || m.ChannelType != c.ctype || m.Text != c.text || !m.HasMedia || m.Media == nil {
			t.Fatalf("%s: mensagem errada %+v", c.ctype, m)
		}
		if !strings.HasSuffix(m.Media.FileName, c.file) {
			t.Fatalf("%s: fileName %q não termina com %q", c.ctype, m.Media.FileName, c.file)
		}
	}
}

func TestDocumentCaptionWins(t *testing.T) {
	msg := &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Title: proto.String("t"), Caption: proto.String("legenda"), Mimetype: proto.String("application/pdf")}}
	if got := FromMessage(dm(msg), fakeResolver{}).Message.Text; got != "legenda" {
		t.Fatalf("text = %q", got)
	}
}

func TestLocationAndContacts(t *testing.T) {
	loc := &waE2E.Message{LocationMessage: &waE2E.LocationMessage{DegreesLatitude: proto.Float64(-23.5505), DegreesLongitude: proto.Float64(-46.6333), JPEGThumbnail: []byte("abc")}}
	want := "data:image/png;base64, YWJj | https://maps.google.com/maps?q=-23.5505%2C-46.6333&z=17&hl=pt-BR|-23.5505, -46.6333 "
	if got := FromMessage(dm(loc), fakeResolver{}).Message.Text; got != want {
		t.Fatalf("location = %q", got)
	}
	live := &waE2E.Message{LiveLocationMessage: &waE2E.LiveLocationMessage{DegreesLatitude: proto.Float64(1.5), DegreesLongitude: proto.Float64(2)}}
	if got := FromMessage(dm(live), fakeResolver{}).Message.Text; got != "Latitude: 1.5 - Longitude: 2" {
		t.Fatalf("live = %q", got)
	}
	vcard := "BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nTEL;type=CELL;waid=5511988887777:+55 11 98888-7777\nEND:VCARD"
	contact := &waE2E.Message{ContactMessage: &waE2E.ContactMessage{Vcard: proto.String(vcard)}}
	if got := FromMessage(dm(contact), fakeResolver{}).Message.Text; got != "55 11 98888-7777/Ana Souza" {
		t.Fatalf("contact = %q", got)
	}
	arr := &waE2E.Message{ContactsArrayMessage: &waE2E.ContactsArrayMessage{Contacts: []*waE2E.ContactMessage{{Vcard: proto.String(vcard)}, {Vcard: proto.String(vcard)}}}}
	if got := FromMessage(dm(arr), fakeResolver{}).Message.Text; got != "55 11 98888-7777/Ana Souza_55 11 98888-7777/Ana Souza" {
		t.Fatalf("contacts = %q", got)
	}
}

func TestEditRevokeReaction(t *testing.T) {
	edit := &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{
		Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(), Key: &waCommon.MessageKey{ID: proto.String("ORIG")},
		EditedMessage: &waE2E.Message{Conversation: proto.String("corrigido")},
	}}
	m := FromMessage(dm(edit), fakeResolver{}).Message
	if m == nil || m.EditOf != "ORIG" || m.Text != "corrigido" || m.ChannelType != "editedMessage" {
		t.Fatalf("edição errada: %+v", m)
	}
	revoke := &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_REVOKE.Enum(), Key: &waCommon.MessageKey{ID: proto.String("ORIG")}}}
	res := FromMessage(dm(revoke), fakeResolver{})
	if res.Message != nil || res.Update == nil || res.Update.ID != "ORIG" || !res.Update.Revoked {
		t.Fatalf("revoke errado: %+v", res)
	}
	react := &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Key: &waCommon.MessageKey{ID: proto.String("ORIG")}, Text: proto.String("👍"), SenderTimestampMS: proto.Int64(1760100000123)}}
	res = FromMessage(dm(react), fakeResolver{})
	if res.Message != nil || res.Reaction == nil || res.Reaction.ID != "ORIG" || res.Reaction.Emoji != "👍" || res.Reaction.At != 1760100000123 || res.Reaction.Sender != "5511999990000@s.whatsapp.net" {
		t.Fatalf("reação errada: %+v", res.Reaction)
	}
}

func TestIgnoredMessages(t *testing.T) {
	status := dm(&waE2E.Message{Conversation: proto.String("status")})
	status.Info.Chat = types.StatusBroadcastJID
	if res := FromMessage(status, fakeResolver{}); res.Message != nil {
		t.Fatal("status@broadcast deveria ser ignorado")
	}
	if res := FromMessage(dm(&waE2E.Message{PollCreationMessage: &waE2E.PollCreationMessage{Name: proto.String("?")}}), fakeResolver{}); res.Message != nil {
		t.Fatal("tipo desconhecido deveria ser ignorado")
	}
}
```

Run: `make test` → FAIL (`FromMessage` não existe).

- [ ] **Step 2: body.go (tipo, texto, mídia, contexto)**

`internal/translate/body.go`:

```go
package translate

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"

	"whatsmeowapi/internal/events"
)

// body descreve o conteúdo de uma mensagem como o Wazzy o mostra.
type body struct {
	channelType string
	kind        string
	text        string
	media       *events.Media
	context     *waE2E.ContextInfo
	editOf      string
}

func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

func mediaOf(mimetype, fileName string) *events.Media {
	if fileName == "" {
		ext := "bin"
		if parts := strings.SplitN(mimetype, "/", 2); len(parts) == 2 && parts[1] != "" {
			ext = strings.SplitN(parts[1], ";", 2)[0]
		}
		fileName = fmt.Sprintf("%d.%s", time.Now().UnixMilli(), strings.TrimSpace(ext))
	}
	return &events.Media{Mimetype: mimetype, FileName: fileName}
}

func locationText(thumb []byte, lat, lng float64) string {
	if len(thumb) == 0 {
		return ""
	}
	return fmt.Sprintf("data:image/png;base64, %s | https://maps.google.com/maps?q=%s%%2C%s&z=17&hl=pt-BR|%s, %s ",
		base64.StdEncoding.EncodeToString(thumb), num(lat), num(lng), num(lat), num(lng))
}

// vcardText repete getContactVCard do Wazzy: primeiro valor com "+" é o
// número (sem o "+"), o valor depois de "FN" é o nome.
func vcardText(vcard string) string {
	number, name := "", ""
	for _, line := range strings.Split(vcard, "\n") {
		values := strings.Split(line, ":")
		for i, v := range values {
			if number == "" && strings.Contains(v, "+") {
				number = strings.Replace(v, "+", "", 1)
			}
			if strings.Contains(v, "FN") && i+1 < len(values) {
				name = values[i+1]
			}
		}
	}
	if number == "" {
		return ""
	}
	return strings.TrimSpace(number) + "/" + strings.TrimSpace(name)
}

func editedText(m *waE2E.Message) string {
	switch {
	case m.GetConversation() != "":
		return m.GetConversation()
	case m.GetExtendedTextMessage().GetText() != "":
		return m.GetExtendedTextMessage().GetText()
	case m.GetImageMessage().GetCaption() != "":
		return m.GetImageMessage().GetCaption()
	default:
		return m.GetVideoMessage().GetCaption()
	}
}

// describe devolve nil para o que o Wazzy ignora.
func describe(m *waE2E.Message) *body {
	switch {
	case m.Conversation != nil:
		return &body{channelType: "conversation", kind: "text", text: m.GetConversation()}
	case m.ExtendedTextMessage != nil:
		x := m.ExtendedTextMessage
		return &body{channelType: "extendedTextMessage", kind: "text", text: x.GetText(), context: x.GetContextInfo()}
	case m.ImageMessage != nil:
		x := m.ImageMessage
		return &body{channelType: "imageMessage", kind: "image", text: x.GetCaption(), media: mediaOf(x.GetMimetype(), ""), context: x.GetContextInfo()}
	case m.VideoMessage != nil:
		x := m.VideoMessage
		return &body{channelType: "videoMessage", kind: "video", text: x.GetCaption(), media: mediaOf(x.GetMimetype(), ""), context: x.GetContextInfo()}
	case m.AudioMessage != nil:
		x := m.AudioMessage
		return &body{channelType: "audioMessage", kind: "audio", text: "Áudio", media: mediaOf(x.GetMimetype(), ""), context: x.GetContextInfo()}
	case m.DocumentMessage != nil:
		x := m.DocumentMessage
		text := x.GetCaption()
		if text == "" {
			text = x.GetTitle()
		}
		return &body{channelType: "documentMessage", kind: "document", text: text, media: mediaOf(x.GetMimetype(), x.GetFileName()), context: x.GetContextInfo()}
	case m.StickerMessage != nil:
		x := m.StickerMessage
		return &body{channelType: "stickerMessage", kind: "sticker", text: "sticker", media: mediaOf(x.GetMimetype(), ""), context: x.GetContextInfo()}
	case m.LocationMessage != nil:
		x := m.LocationMessage
		return &body{channelType: "locationMessage", kind: "location", text: locationText(x.GetJPEGThumbnail(), x.GetDegreesLatitude(), x.GetDegreesLongitude()), context: x.GetContextInfo()}
	case m.LiveLocationMessage != nil:
		x := m.LiveLocationMessage
		return &body{channelType: "liveLocationMessage", kind: "location", text: fmt.Sprintf("Latitude: %s - Longitude: %s", num(x.GetDegreesLatitude()), num(x.GetDegreesLongitude())), context: x.GetContextInfo()}
	case m.ContactMessage != nil:
		x := m.ContactMessage
		return &body{channelType: "contactMessage", kind: "contact", text: vcardText(x.GetVcard()), context: x.GetContextInfo()}
	case m.ContactsArrayMessage != nil:
		x := m.ContactsArrayMessage
		parts := make([]string, 0, len(x.GetContacts()))
		for _, c := range x.GetContacts() {
			parts = append(parts, vcardText(c.GetVcard()))
		}
		return &body{channelType: "contactsArrayMessage", kind: "contacts", text: strings.Join(parts, "_"), context: x.GetContextInfo()}
	case m.ButtonsResponseMessage != nil:
		return &body{channelType: "buttonsResponseMessage", kind: "text", text: m.ButtonsResponseMessage.GetSelectedButtonID(), context: m.ButtonsResponseMessage.GetContextInfo()}
	case m.ListResponseMessage != nil:
		return &body{channelType: "listResponseMessage", kind: "text", text: m.ListResponseMessage.GetSingleSelectReply().GetSelectedRowID(), context: m.ListResponseMessage.GetContextInfo()}
	case m.TemplateButtonReplyMessage != nil:
		return &body{channelType: "templateButtonReplyMessage", kind: "text", text: m.TemplateButtonReplyMessage.GetSelectedID(), context: m.TemplateButtonReplyMessage.GetContextInfo()}
	case m.ProtocolMessage != nil && m.ProtocolMessage.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT:
		p := m.ProtocolMessage
		return &body{channelType: "editedMessage", kind: "text", text: editedText(p.GetEditedMessage()), editOf: p.GetKey().GetID()}
	}
	return nil
}

// MediaOf devolve a parte baixável da mensagem e o nome/tipo do arquivo.
func MediaOf(m *waE2E.Message) (whatsmeow.DownloadableMessage, events.Media, bool) {
	b := describe(m)
	if b == nil || b.media == nil {
		return nil, events.Media{}, false
	}
	var d whatsmeow.DownloadableMessage
	switch {
	case m.ImageMessage != nil:
		d = m.ImageMessage
	case m.VideoMessage != nil:
		d = m.VideoMessage
	case m.AudioMessage != nil:
		d = m.AudioMessage
	case m.DocumentMessage != nil:
		d = m.DocumentMessage
	case m.StickerMessage != nil:
		d = m.StickerMessage
	}
	return d, *b.media, d != nil
}
```

- [ ] **Step 3: raw.go**

`internal/translate/raw.go`:

```go
package translate

import (
	"encoding/json"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/encoding/protojson"
)

type rawKey struct {
	ID          string `json:"id"`
	RemoteJID   string `json:"remoteJid"`
	FromMe      bool   `json:"fromMe"`
	Participant string `json:"participant,omitempty"`
}

type rawMessage struct {
	Key              rawKey          `json:"key"`
	Message          json.RawMessage `json:"message"`
	PushName         string          `json:"pushName,omitempty"`
	MessageTimestamp int64           `json:"messageTimestamp"`
}

// Raw é o payload guardado em Message.dataJson: mesmo formato de topo do
// Baileys ({key, message}), com a mensagem em protojson.
func Raw(info types.MessageInfo, msg *waE2E.Message) json.RawMessage {
	body, err := protojson.Marshal(msg)
	if err != nil || len(body) == 0 {
		body = []byte("{}")
	}
	key := rawKey{ID: info.ID, RemoteJID: info.Chat.String(), FromMe: info.IsFromMe}
	if info.IsGroup && !info.IsFromMe {
		key.Participant = info.Sender.ToNonAD().String()
	}
	out, _ := json.Marshal(rawMessage{Key: key, Message: body, PushName: info.PushName, MessageTimestamp: info.Timestamp.Unix()})
	return out
}
```

- [ ] **Step 4: message.go (remetente, LID, resultado)**

`internal/translate/message.go`:

```go
// Package translate transforma eventos do whatsmeow no envelope publicado
// para o Wazzy. Não faz rede nem banco: o que precisa saber vem do Resolver.
package translate

import (
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	wevents "go.mau.fi/whatsmeow/types/events"

	"whatsmeowapi/internal/events"
)

type Resolver interface {
	// PhoneFor devolve o JID de telefone de um LID, ou types.EmptyJID.
	PhoneFor(lid types.JID) types.JID
	// GroupName devolve o assunto do grupo, ou "" quando não dá para saber.
	GroupName(chat types.JID) string
	Me() types.JID
	MyName() string
}

type Result struct {
	Message    *events.Message
	Reaction   *events.Reaction
	Update     *events.MessageUpdate
	LIDMapping *events.LIDMapping
}

// phoneAndLID separa, entre dois endereços, o de telefone e o LID; busca o
// telefone no Resolver quando só há LID.
func phoneAndLID(a, b types.JID, r Resolver) (phone, lid types.JID) {
	for _, j := range []types.JID{a, b} {
		switch j.Server {
		case types.DefaultUserServer:
			if phone.IsEmpty() {
				phone = j.ToNonAD()
			}
		case types.HiddenUserServer:
			if lid.IsEmpty() {
				lid = j.ToNonAD()
			}
		}
	}
	if phone.IsEmpty() && !lid.IsEmpty() {
		phone = r.PhoneFor(lid)
	}
	return phone, lid
}

func senderFrom(phone, lid types.JID, name string) events.Sender {
	s := events.Sender{Name: name}
	if !lid.IsEmpty() {
		s.LID = lid.String()
	}
	if !phone.IsEmpty() {
		s.JID = phone.String()
	} else {
		s.JID = s.LID
	}
	return s
}

// senderOf: em conversa privada, o contato (mesmo nas nossas mensagens, que
// não podem renomear o contato com o nosso nome); em grupo, quem escreveu.
func senderOf(info types.MessageInfo, r Resolver) (events.Sender, *events.LIDMapping) {
	var phone, lid types.JID
	name := info.PushName
	switch {
	case !info.IsGroup:
		alt := info.SenderAlt
		if info.IsFromMe {
			alt = info.RecipientAlt
		}
		phone, lid = phoneAndLID(info.Chat, alt, r)
		if info.IsFromMe {
			name = phone.User
		}
	case info.IsFromMe:
		return events.Sender{JID: r.Me().String(), Name: r.MyName()}, nil
	default:
		phone, lid = phoneAndLID(info.Sender, info.SenderAlt, r)
	}
	var mapping *events.LIDMapping
	if !phone.IsEmpty() && !lid.IsEmpty() {
		mapping = &events.LIDMapping{LID: lid.String(), PN: phone.String()}
	}
	return senderFrom(phone, lid, name), mapping
}

func ignored(info types.MessageInfo) bool {
	return info.Chat == types.StatusBroadcastJID || info.Chat.Server == types.NewsletterServer || info.Chat.Server == types.BroadcastServer
}

func FromMessage(evt *wevents.Message, r Resolver) Result {
	info, msg := evt.Info, evt.Message
	if msg == nil || ignored(info) {
		return Result{}
	}
	sender, mapping := senderOf(info, r)
	res := Result{LIDMapping: mapping}

	if p := msg.GetProtocolMessage(); p != nil && p.GetType() == waE2E.ProtocolMessage_REVOKE {
		res.Update = &events.MessageUpdate{ID: p.GetKey().GetID(), Chat: info.Chat.String(), Revoked: true}
		return res
	}
	if x := msg.GetReactionMessage(); x != nil {
		who := sender.JID
		if info.IsFromMe {
			who = "me"
		}
		res.Reaction = &events.Reaction{ID: x.GetKey().GetID(), Chat: info.Chat.String(), Sender: who, FromMe: info.IsFromMe, Emoji: x.GetText(), At: x.GetSenderTimestampMS()}
		return res
	}

	b := describe(msg)
	if b == nil {
		return res
	}
	chat := events.Chat{JID: info.Chat.String(), IsGroup: info.IsGroup}
	if info.IsGroup {
		chat.Name = r.GroupName(info.Chat)
	}
	mentions := b.context.GetMentionedJID()
	if mentions == nil {
		mentions = []string{}
	}
	res.Message = &events.Message{
		ID:          info.ID,
		FromMe:      info.IsFromMe,
		Timestamp:   info.Timestamp.UnixMilli(),
		Chat:        chat,
		Sender:      sender,
		Kind:        b.kind,
		ChannelType: b.channelType,
		Text:        b.text,
		HasMedia:    b.media != nil,
		Media:       b.media,
		QuotedID:    b.context.GetStanzaID(),
		EditOf:      b.editOf,
		Forwarded:   b.context.GetIsForwarded(),
		Mentions:    mentions,
		Raw:         Raw(info, msg),
	}
	return res
}
```

Run: `make test` → PASS. Se algum nome de campo do proto não compilar, conferir em `$(go env GOMODCACHE)/go.mau.fi/whatsmeow@*/proto/waE2E/WAWebProtobufsE2E.pb.go` (via `docker run ... sh`) e ajustar o código, **não o teste**.

- [ ] **Step 5: Commit**

```bash
git add internal/translate
git commit -m "feat: tradução das mensagens do whatsmeow para o envelope do Wazzy

Mesmos textos do parse.ts (localização, vCard, áudio, figurinha) e mesma
regra de remetente do toInbound.ts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Caminhos de mídia seguros e pasta de passagem

**Files:**
- Create: `internal/media/media.go`, `internal/media/media_test.go`

**Interfaces:**
- Produces:
  - `var ErrUnsafePath = errors.New("caminho fora da pasta de mídia")`;
  - `func SafeJoin(root, rel string) (string, error)`;
  - `func InDir(root string) string` → `root/.gateway/in`;
  - `func WriteIncoming(root string, connectionID int, ext string, data []byte) (rel string, err error)` → grava em `.gateway/in/{connectionID}-{nanos}.{ext}` e devolve o caminho relativo;
  - `func Cleanup(root string, olderThan time.Duration) (removed int, err error)` → apaga arquivos de `.gateway/in` e `.gateway/out` mais velhos que `olderThan`.

- [ ] **Step 1: Testes (falham)**

`internal/media/media_test.go`:

```go
package media

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSafeJoin(t *testing.T) {
	root := t.TempDir()
	ok, err := SafeJoin(root, ".gateway/out/a.jpg")
	if err != nil || ok != filepath.Join(root, ".gateway/out/a.jpg") {
		t.Fatalf("caminho válido recusado: %q %v", ok, err)
	}
	for _, bad := range []string{"../etc/passwd", "/etc/passwd", "company1/../../x", ""} {
		if _, err := SafeJoin(root, bad); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("%q deveria ser recusado, err=%v", bad, err)
		}
	}
}

func TestWriteIncomingAndCleanup(t *testing.T) {
	root := t.TempDir()
	rel, err := WriteIncoming(root, 7, "jpeg", []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(rel) != ".gateway/in" || filepath.Ext(rel) != ".jpeg" {
		t.Fatalf("caminho relativo errado: %s", rel)
	}
	if _, err := os.Stat(filepath.Join(root, rel)); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(root, ".gateway/out/velho.bin")
	_ = os.MkdirAll(filepath.Dir(old), 0o755)
	_ = os.WriteFile(old, []byte("x"), 0o644)
	past := time.Now().Add(-25 * time.Hour)
	_ = os.Chtimes(old, past, past)

	removed, err := Cleanup(root, 24*time.Hour)
	if err != nil || removed != 1 {
		t.Fatalf("removed=%d err=%v", removed, err)
	}
	if _, err := os.Stat(filepath.Join(root, rel)); err != nil {
		t.Fatal("arquivo novo não deveria ser apagado")
	}
}
```

Run: `make test` → FAIL.

- [ ] **Step 2: Implementar**

`internal/media/media.go`:

```go
// Package media cuida dos arquivos no volume comum com a api do Wazzy.
// A pasta .gateway começa com ponto: o Express do Wazzy não a serve.
package media

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var ErrUnsafePath = errors.New("caminho fora da pasta de mídia")

const gatewayDir = ".gateway"

func SafeJoin(root, rel string) (string, error) {
	if rel == "" || filepath.IsAbs(rel) {
		return "", ErrUnsafePath
	}
	full := filepath.Join(root, rel)
	back, err := filepath.Rel(root, full)
	if err != nil || back == ".." || strings.HasPrefix(back, ".."+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	return full, nil
}

func InDir(root string) string { return filepath.Join(root, gatewayDir, "in") }

func WriteIncoming(root string, connectionID int, ext string, data []byte) (string, error) {
	if err := os.MkdirAll(InDir(root), 0o755); err != nil {
		return "", err
	}
	if ext == "" {
		ext = "bin"
	}
	rel := filepath.Join(gatewayDir, "in", fmt.Sprintf("%d-%d.%s", connectionID, time.Now().UnixNano(), ext))
	if err := os.WriteFile(filepath.Join(root, rel), data, 0o644); err != nil {
		return "", err
	}
	return rel, nil
}

// Cleanup apaga o que ficou para trás nas pastas de passagem (o Node apaga
// depois de usar; isto cobre falhas).
func Cleanup(root string, olderThan time.Duration) (int, error) {
	limit := time.Now().Add(-olderThan)
	removed := 0
	for _, dir := range []string{"in", "out"} {
		entries, err := os.ReadDir(filepath.Join(root, gatewayDir, dir))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return removed, err
		}
		for _, e := range entries {
			info, err := e.Info()
			if err != nil || e.IsDir() || info.ModTime().After(limit) {
				continue
			}
			if os.Remove(filepath.Join(root, gatewayDir, dir, e.Name())) == nil {
				removed++
			}
		}
	}
	return removed, nil
}
```

Run: `make test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add internal/media
git commit -m "feat: caminhos de mídia seguros e pasta de passagem do gateway

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Montagem das mensagens enviadas

**Files:**
- Create: `internal/outgoing/address.go`, `internal/outgoing/build.go`, `internal/outgoing/build_test.go`

**Interfaces:**
- Consumes: `media.SafeJoin` (Task 4).
- Produces:
  - `var ErrInvalid = errors.New("pedido inválido")` (erros de validação embrulham `ErrInvalid` com `fmt.Errorf("%w: ...", ErrInvalid)`);
  - `type Address struct{ JID string \`json:"jid,omitempty"\`; Number string \`json:"number,omitempty"\`; LID string \`json:"lid,omitempty"\`; IsGroup bool \`json:"isGroup,omitempty"\` }`;
  - `func ResolveTo(a Address) (types.JID, error)`;
  - `type Content struct{ Type, Text string; Mentions []string; Caption, FileName, Mimetype string; Voice bool; Path string }` (tags JSON em camelCase: `type, text, mentions, caption, fileName, mimetype, voice, path`);
  - `type Quoted struct{ ID, Chat, Sender string; FromMe bool; Text string }` (tags `id, chat, sender, fromMe, text`);
  - `type SendRequest struct{ To Address; Content Content; Quoted *Quoted; Forwarded bool }` (tags `to, content, quoted, forwarded`);
  - `type Uploader interface{ Upload(ctx context.Context, data []byte, t whatsmeow.MediaType) (whatsmeow.UploadResponse, error) }` (`*whatsmeow.Client` satisfaz);
  - `func Build(ctx context.Context, up Uploader, root string, req SendRequest, me types.JID) (*waE2E.Message, error)`.

Regras de endereço: `jid` tem prioridade; senão grupo → `{number}@g.us`; senão `lid` (já vem como `123@lid`, ou só dígitos → acrescenta `@lid`); senão `{dígitos de number}@s.whatsapp.net`. Nada disso → `ErrInvalid`.

Regras de conteúdo: texto sem menção, citação nem encaminhamento → `Conversation`; com qualquer um deles → `ExtendedTextMessage` com `ContextInfo`. Mídia: lê `path` com `SafeJoin`, faz upload, monta `ImageMessage`/`VideoMessage`/`AudioMessage` (`PTT` = `voice`; mimetype padrão `audio/ogg; codecs=opus` quando `voice` e vazio)/`DocumentMessage` (`FileName`, `Title` = `fileName`). Mimetype vazio nos outros → `http.DetectContentType`. O `ContextInfo` (citação, encaminhada) vai também na mídia.

Citação: `StanzaID` = `quoted.id`; `Participant` = `me` se `fromMe`, senão `quoted.sender`; `QuotedMessage` = `{Conversation: quoted.text}`.

- [ ] **Step 1: Testes (falham)**

`internal/outgoing/build_test.go`:

```go
package outgoing

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

type fakeUploader struct{ got whatsmeow.MediaType; size int }

func (f *fakeUploader) Upload(ctx context.Context, data []byte, t whatsmeow.MediaType) (whatsmeow.UploadResponse, error) {
	f.got, f.size = t, len(data)
	return whatsmeow.UploadResponse{URL: "https://mmg", DirectPath: "/d", MediaKey: []byte("k"), FileSHA256: []byte("s"), FileEncSHA256: []byte("e"), FileLength: uint64(len(data))}, nil
}

var me = types.NewJID("5511000000000", types.DefaultUserServer)

func TestResolveTo(t *testing.T) {
	cases := map[string]Address{
		"5511999990000@s.whatsapp.net":   {Number: "+55 (11) 99999-0000"},
		"123@lid":                        {Number: "5511999990000", LID: "123@lid"},
		"456@lid":                        {LID: "456"},
		"120363000000000001@g.us":        {Number: "120363000000000001", IsGroup: true},
		"999@s.whatsapp.net":             {JID: "999@s.whatsapp.net", Number: "111"},
	}
	for want, addr := range cases {
		got, err := ResolveTo(addr)
		if err != nil || got.String() != want {
			t.Fatalf("%+v → %s (%v), quero %s", addr, got, err, want)
		}
	}
	if _, err := ResolveTo(Address{}); !errors.Is(err, ErrInvalid) {
		t.Fatal("endereço vazio deveria ser inválido")
	}
}

func TestPlainTextIsConversation(t *testing.T) {
	msg, err := Build(context.Background(), &fakeUploader{}, t.TempDir(), SendRequest{Content: Content{Type: "text", Text: "oi"}}, me)
	if err != nil || msg.GetConversation() != "oi" || msg.ExtendedTextMessage != nil {
		t.Fatalf("msg=%v err=%v", msg, err)
	}
}

func TestTextWithMentionsQuoteAndForward(t *testing.T) {
	req := SendRequest{
		Content:   Content{Type: "text", Text: "@ana oi", Mentions: []string{"555@lid"}},
		Quoted:    &Quoted{ID: "Q1", Chat: "120363000000000001@g.us", Sender: "987@lid", Text: "pergunta"},
		Forwarded: true,
	}
	msg, err := Build(context.Background(), &fakeUploader{}, t.TempDir(), req, me)
	if err != nil {
		t.Fatal(err)
	}
	x := msg.GetExtendedTextMessage()
	ctx := x.GetContextInfo()
	if x.GetText() != "@ana oi" || ctx.GetStanzaID() != "Q1" || ctx.GetParticipant() != "987@lid" ||
		ctx.GetQuotedMessage().GetConversation() != "pergunta" || !ctx.GetIsForwarded() || len(ctx.GetMentionedJID()) != 1 {
		t.Fatalf("contexto errado: %v", x)
	}
}

func TestQuoteOfOwnMessageUsesMe(t *testing.T) {
	req := SendRequest{Content: Content{Type: "text", Text: "x"}, Quoted: &Quoted{ID: "Q2", FromMe: true, Text: "minha"}}
	msg, _ := Build(context.Background(), &fakeUploader{}, t.TempDir(), req, me)
	if got := msg.GetExtendedTextMessage().GetContextInfo().GetParticipant(); got != me.String() {
		t.Fatalf("participant = %s", got)
	}
}

func TestMediaFromPath(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, ".gateway/out"), 0o755)
	_ = os.WriteFile(filepath.Join(root, ".gateway/out/a.pdf"), []byte("%PDF-1.4 conteudo"), 0o644)

	up := &fakeUploader{}
	req := SendRequest{Content: Content{Type: "document", Path: ".gateway/out/a.pdf", FileName: "contrato.pdf", Mimetype: "application/pdf", Caption: "segue"}}
	msg, err := Build(context.Background(), up, root, req, me)
	if err != nil {
		t.Fatal(err)
	}
	d := msg.GetDocumentMessage()
	if up.got != whatsmeow.MediaDocument || d.GetFileName() != "contrato.pdf" || d.GetCaption() != "segue" || d.GetURL() != "https://mmg" || d.GetFileLength() != uint64(up.size) {
		t.Fatalf("documento errado: %v", d)
	}

	_ = os.WriteFile(filepath.Join(root, ".gateway/out/v.ogg"), []byte("OggS"), 0o644)
	msg, err = Build(context.Background(), up, root, SendRequest{Content: Content{Type: "audio", Path: ".gateway/out/v.ogg", Voice: true}}, me)
	if err != nil || !msg.GetAudioMessage().GetPTT() || msg.GetAudioMessage().GetMimetype() != "audio/ogg; codecs=opus" {
		t.Fatalf("áudio errado: %v %v", msg, err)
	}
}

func TestMediaPathErrors(t *testing.T) {
	root := t.TempDir()
	for _, p := range []string{"../../etc/passwd", ".gateway/out/nao-existe.jpg", ""} {
		_, err := Build(context.Background(), &fakeUploader{}, root, SendRequest{Content: Content{Type: "image", Path: p}}, me)
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("path %q: esperava ErrInvalid, veio %v", p, err)
		}
	}
	if _, err := Build(context.Background(), &fakeUploader{}, root, SendRequest{Content: Content{Type: "gif"}}, me); !errors.Is(err, ErrInvalid) {
		t.Fatal("tipo desconhecido deveria ser inválido")
	}
}
```

Run: `make test` → FAIL.

- [ ] **Step 2: address.go**

`internal/outgoing/address.go`:

```go
// Package outgoing transforma os pedidos de envio do Wazzy em mensagens do
// whatsmeow. Só faz rede pelo Uploader (upload de mídia).
package outgoing

import (
	"errors"
	"fmt"
	"strings"
	"unicode"

	"go.mau.fi/whatsmeow/types"
)

var ErrInvalid = errors.New("pedido inválido")

type Address struct {
	JID     string `json:"jid,omitempty"`
	Number  string `json:"number,omitempty"`
	LID     string `json:"lid,omitempty"`
	IsGroup bool   `json:"isGroup,omitempty"`
}

func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, s)
}

// ResolveTo: mesma regra do BaileysChannel (LID quando conhecido).
func ResolveTo(a Address) (types.JID, error) {
	switch {
	case a.JID != "":
		j, err := types.ParseJID(a.JID)
		if err != nil {
			return types.EmptyJID, fmt.Errorf("%w: jid %q", ErrInvalid, a.JID)
		}
		return j, nil
	case a.IsGroup && a.Number != "":
		return types.NewJID(digits(a.Number), types.GroupServer), nil
	case a.LID != "":
		if strings.Contains(a.LID, "@") {
			j, err := types.ParseJID(a.LID)
			if err != nil {
				return types.EmptyJID, fmt.Errorf("%w: lid %q", ErrInvalid, a.LID)
			}
			return j, nil
		}
		return types.NewJID(digits(a.LID), types.HiddenUserServer), nil
	case digits(a.Number) != "":
		return types.NewJID(digits(a.Number), types.DefaultUserServer), nil
	}
	return types.EmptyJID, fmt.Errorf("%w: destino sem jid, lid ou número", ErrInvalid)
}
```

- [ ] **Step 3: build.go**

`internal/outgoing/build.go`:

```go
package outgoing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"

	"whatsmeowapi/internal/media"
)

type Content struct {
	Type     string   `json:"type"`
	Text     string   `json:"text,omitempty"`
	Mentions []string `json:"mentions,omitempty"`
	Caption  string   `json:"caption,omitempty"`
	FileName string   `json:"fileName,omitempty"`
	Mimetype string   `json:"mimetype,omitempty"`
	Voice    bool     `json:"voice,omitempty"`
	Path     string   `json:"path,omitempty"`
}

type Quoted struct {
	ID     string `json:"id"`
	Chat   string `json:"chat,omitempty"`
	Sender string `json:"sender,omitempty"`
	FromMe bool   `json:"fromMe,omitempty"`
	Text   string `json:"text,omitempty"`
}

type SendRequest struct {
	To        Address `json:"to"`
	Content   Content `json:"content"`
	Quoted    *Quoted `json:"quoted,omitempty"`
	Forwarded bool    `json:"forwarded,omitempty"`
}

type Uploader interface {
	Upload(ctx context.Context, data []byte, t whatsmeow.MediaType) (whatsmeow.UploadResponse, error)
}

func contextInfo(req SendRequest, me types.JID) *waE2E.ContextInfo {
	if req.Quoted == nil && !req.Forwarded && len(req.Content.Mentions) == 0 {
		return nil
	}
	ci := &waE2E.ContextInfo{}
	if len(req.Content.Mentions) > 0 {
		ci.MentionedJID = req.Content.Mentions
	}
	if q := req.Quoted; q != nil {
		participant := q.Sender
		if q.FromMe {
			participant = me.String()
		}
		ci.StanzaID = proto.String(q.ID)
		ci.Participant = proto.String(participant)
		ci.QuotedMessage = &waE2E.Message{Conversation: proto.String(q.Text)}
	}
	if req.Forwarded {
		ci.IsForwarded = proto.Bool(true)
		ci.ForwardingScore = proto.Uint32(1)
	}
	return ci
}

func Build(ctx context.Context, up Uploader, root string, req SendRequest, me types.JID) (*waE2E.Message, error) {
	c := req.Content
	ci := contextInfo(req, me)
	if c.Type == "text" {
		if ci == nil {
			return &waE2E.Message{Conversation: proto.String(c.Text)}, nil
		}
		return &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String(c.Text), ContextInfo: ci}}, nil
	}

	kinds := map[string]whatsmeow.MediaType{"image": whatsmeow.MediaImage, "video": whatsmeow.MediaVideo, "audio": whatsmeow.MediaAudio, "document": whatsmeow.MediaDocument}
	kind, ok := kinds[c.Type]
	if !ok {
		return nil, fmt.Errorf("%w: tipo %q", ErrInvalid, c.Type)
	}
	full, err := media.SafeJoin(root, c.Path)
	if err != nil {
		return nil, fmt.Errorf("%w: path %q", ErrInvalid, c.Path)
	}
	data, err := os.ReadFile(full)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("%w: arquivo %q não existe", ErrInvalid, c.Path)
	}
	if err != nil {
		return nil, err
	}
	mimetype := c.Mimetype
	if mimetype == "" && c.Type == "audio" && c.Voice {
		mimetype = "audio/ogg; codecs=opus"
	}
	if mimetype == "" {
		mimetype = http.DetectContentType(data)
	}
	up2, err := up.Upload(ctx, data, kind)
	if err != nil {
		return nil, fmt.Errorf("upload: %w", err)
	}
	size := proto.Uint64(uint64(len(data)))
	switch c.Type {
	case "image":
		return &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Caption: proto.String(c.Caption), Mimetype: proto.String(mimetype), URL: proto.String(up2.URL), DirectPath: proto.String(up2.DirectPath), MediaKey: up2.MediaKey, FileSHA256: up2.FileSHA256, FileEncSHA256: up2.FileEncSHA256, FileLength: size, ContextInfo: ci}}, nil
	case "video":
		return &waE2E.Message{VideoMessage: &waE2E.VideoMessage{Caption: proto.String(c.Caption), Mimetype: proto.String(mimetype), URL: proto.String(up2.URL), DirectPath: proto.String(up2.DirectPath), MediaKey: up2.MediaKey, FileSHA256: up2.FileSHA256, FileEncSHA256: up2.FileEncSHA256, FileLength: size, ContextInfo: ci}}, nil
	case "audio":
		return &waE2E.Message{AudioMessage: &waE2E.AudioMessage{PTT: proto.Bool(c.Voice), Mimetype: proto.String(mimetype), URL: proto.String(up2.URL), DirectPath: proto.String(up2.DirectPath), MediaKey: up2.MediaKey, FileSHA256: up2.FileSHA256, FileEncSHA256: up2.FileEncSHA256, FileLength: size, ContextInfo: ci}}, nil
	default:
		return &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{FileName: proto.String(c.FileName), Title: proto.String(c.FileName), Caption: proto.String(c.Caption), Mimetype: proto.String(mimetype), URL: proto.String(up2.URL), DirectPath: proto.String(up2.DirectPath), MediaKey: up2.MediaKey, FileSHA256: up2.FileSHA256, FileEncSHA256: up2.FileEncSHA256, FileLength: size, ContextInfo: ci}}, nil
	}
}
```

Run: `make test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/outgoing
git commit -m "feat: montagem das mensagens enviadas (texto, menções, citação, mídia)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tradução dos outros eventos

**Files:**
- Create: `internal/translate/other.go`, `internal/translate/other_test.go`

**Interfaces:**
- Consumes: `Resolver`, `FromMessage` (Task 3).
- Produces:
  - `func Receipt(evt *wevents.Receipt) *events.Receipt` (nil para tipos que o Wazzy não usa);
  - `func Presence(evt *wevents.ChatPresence) events.Presence`;
  - `func CallOffer(evt *wevents.CallOffer) events.Call`, `func CallTerminate(evt *wevents.CallTerminate) events.Call`;
  - `func ContactFromAction(evt *wevents.Contact) events.Contact`, `func ContactFromPushName(evt *wevents.PushName) events.Contact`;
  - `const HistoryChunk = 200`;
  - `func History(msgs []*wevents.Message, pushnames []*waHistorySync.Pushname, progress int, final bool, r Resolver) []events.History` (fatias de até 200 mensagens; `final` só na última fatia; contatos só na primeira);
  - `func HistoryLIDMappings(data *waHistorySync.HistorySync) []events.LIDMapping`.

Recibos: `IsFromMe` = lida/ouvida por nós em outro aparelho → `read_self`/`played_self` (tipos `read`, `read-self`, `played`, `played-self`); senão `delivered` (tipo vazio), `read`, `played`. Outros tipos (`sender`, `retry`, `server-error`, `inactive`, `peer_msg`, `hist_sync`) → nil. `sender` do recibo: `MessageSender` quando preenchido, senão `Sender`.

Presença: `composing` com mídia `audio` → `recording`; `composing` → `composing`; `paused` → `paused`.

Chamada: `isGroup` = `GroupJID` não vazio; `isVideo` = nó `Data` tem filho `video`; `from` = `CallCreator` (ou `From` se vazio), sem device.

- [ ] **Step 1: Testes (falham)**

`internal/translate/other_test.go`:

```go
package translate

import (
	"fmt"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waSyncAction"
	"go.mau.fi/whatsmeow/types"
	wevents "go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestReceiptStatuses(t *testing.T) {
	base := types.MessageSource{Chat: contactPN, Sender: contactPN}
	cases := []struct {
		fromMe bool
		typ    types.ReceiptType
		want   string
	}{
		{false, types.ReceiptTypeDelivered, "delivered"},
		{false, types.ReceiptTypeRead, "read"},
		{false, types.ReceiptTypePlayed, "played"},
		{true, types.ReceiptTypeRead, "read_self"},
		{true, types.ReceiptTypeReadSelf, "read_self"},
		{true, types.ReceiptTypePlayedSelf, "played_self"},
	}
	for _, c := range cases {
		src := base
		src.IsFromMe = c.fromMe
		got := Receipt(&wevents.Receipt{MessageSource: src, MessageIDs: []string{"A", "B"}, Type: c.typ})
		if got == nil || got.Status != c.want || len(got.IDs) != 2 || got.Chat != contactPN.String() {
			t.Fatalf("%v/%q → %+v, quero %s", c.fromMe, c.typ, got, c.want)
		}
	}
	if Receipt(&wevents.Receipt{MessageSource: base, Type: types.ReceiptTypeRetry}) != nil {
		t.Fatal("retry deveria ser ignorado")
	}
}

func TestPresenceStates(t *testing.T) {
	src := types.MessageSource{Chat: contactPN, Sender: contactPN}
	if p := Presence(&wevents.ChatPresence{MessageSource: src, State: types.ChatPresenceComposing, Media: types.ChatPresenceMediaAudio}); p.State != "recording" {
		t.Fatalf("state = %s", p.State)
	}
	if p := Presence(&wevents.ChatPresence{MessageSource: src, State: types.ChatPresenceComposing}); p.State != "composing" {
		t.Fatalf("state = %s", p.State)
	}
	if p := Presence(&wevents.ChatPresence{MessageSource: src, State: types.ChatPresencePaused}); p.State != "paused" || p.Chat != contactPN.String() {
		t.Fatalf("presença errada: %+v", p)
	}
}

func TestCalls(t *testing.T) {
	meta := types.BasicCallMeta{From: contactPN, CallCreator: types.NewADJID("5511999990000", 0, 3), CallID: "C1", Timestamp: ts}
	offer := CallOffer(&wevents.CallOffer{BasicCallMeta: meta, Data: &waBinary.Node{Tag: "offer", Content: []waBinary.Node{{Tag: "video"}}}})
	if offer.Event != "offer" || offer.CallID != "C1" || offer.From != "5511999990000@s.whatsapp.net" || !offer.IsVideo || offer.IsGroup {
		t.Fatalf("offer errado: %+v", offer)
	}
	end := CallTerminate(&wevents.CallTerminate{BasicCallMeta: meta, Reason: "timeout"})
	if end.Event != "terminate" || end.CallID != "C1" {
		t.Fatalf("terminate errado: %+v", end)
	}
}

func TestContacts(t *testing.T) {
	c := ContactFromAction(&wevents.Contact{JID: contactLID, Action: &waSyncAction.ContactAction{FullName: proto.String("Maria Silva"), PnJID: proto.String("5511999990000@s.whatsapp.net")}})
	if c.JID != "5511999990000@s.whatsapp.net" || c.LID != "123456789@lid" || c.Name != "Maria Silva" {
		t.Fatalf("contato errado: %+v", c)
	}
	p := ContactFromPushName(&wevents.PushName{JID: contactPN, JIDAlt: contactLID, NewPushName: "Mari"})
	if p.JID != "5511999990000@s.whatsapp.net" || p.LID != "123456789@lid" || p.Notify != "Mari" {
		t.Fatalf("push name errado: %+v", p)
	}
}

func TestHistoryChunks(t *testing.T) {
	msgs := make([]*wevents.Message, 0, 450)
	for i := 0; i < 450; i++ {
		evt := dm(&waE2E.Message{Conversation: proto.String("x")})
		evt.Info.ID = types.MessageID(fmt.Sprintf("H%d", i))
		evt.Info.Timestamp = time.UnixMilli(int64(i))
		msgs = append(msgs, evt)
	}
	pushnames := []*waHistorySync.Pushname{{ID: proto.String("5511999990000@s.whatsapp.net"), Pushname: proto.String("Maria")}}
	chunks := History(msgs, pushnames, 100, true, fakeResolver{})
	if len(chunks) != 3 || len(chunks[0].Messages) != 200 || len(chunks[2].Messages) != 50 {
		t.Fatalf("fatias erradas: %d", len(chunks))
	}
	if chunks[0].Final || chunks[1].Final || !chunks[2].Final {
		t.Fatal("final só na última fatia")
	}
	if len(chunks[0].Contacts) != 1 || len(chunks[1].Contacts) != 0 || chunks[0].Contacts[0].Notify != "Maria" {
		t.Fatal("contatos só na primeira fatia")
	}
	for _, m := range chunks[1].Messages {
		if !m.History {
			t.Fatal("mensagens do histórico devem vir com history=true")
		}
	}
	if got := History(nil, pushnames, 40, false, fakeResolver{}); len(got) != 1 || len(got[0].Contacts) != 1 {
		t.Fatal("lote sem mensagens ainda leva os contatos")
	}
}

func TestHistoryLIDMappings(t *testing.T) {
	data := &waHistorySync.HistorySync{PhoneNumberToLidMappings: []*waHistorySync.PhoneNumberToLIDMapping{{PnJID: proto.String("5511999990000@s.whatsapp.net"), LidJID: proto.String("123456789@lid")}}}
	got := HistoryLIDMappings(data)
	if len(got) != 1 || got[0].LID != "123456789@lid" || got[0].PN != "5511999990000@s.whatsapp.net" {
		t.Fatalf("mapeamentos errados: %+v", got)
	}
}
```

Run: `make test` → FAIL.

- [ ] **Step 2: Implementar**

`internal/translate/other.go`:

```go
package translate

import (
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/types"
	wevents "go.mau.fi/whatsmeow/types/events"

	"whatsmeowapi/internal/events"
)

func Receipt(evt *wevents.Receipt) *events.Receipt {
	var status string
	if evt.IsFromMe {
		switch evt.Type {
		case types.ReceiptTypeRead, types.ReceiptTypeReadSelf:
			status = "read_self"
		case types.ReceiptTypePlayed, types.ReceiptTypePlayedSelf:
			status = "played_self"
		}
	} else {
		switch evt.Type {
		case types.ReceiptTypeDelivered:
			status = "delivered"
		case types.ReceiptTypeRead:
			status = "read"
		case types.ReceiptTypePlayed:
			status = "played"
		}
	}
	if status == "" {
		return nil
	}
	sender := evt.MessageSender
	if sender.IsEmpty() {
		sender = evt.Sender
	}
	return &events.Receipt{IDs: evt.MessageIDs, Chat: evt.Chat.String(), Sender: sender.ToNonAD().String(), IsGroup: evt.IsGroup, Status: status}
}

func Presence(evt *wevents.ChatPresence) events.Presence {
	state := string(evt.State)
	if evt.State == types.ChatPresenceComposing && evt.Media == types.ChatPresenceMediaAudio {
		state = "recording"
	}
	return events.Presence{Chat: evt.Chat.String(), Sender: evt.Sender.ToNonAD().String(), State: state}
}

func call(event string, meta types.BasicCallMeta) events.Call {
	from := meta.CallCreator
	if from.IsEmpty() {
		from = meta.From
	}
	return events.Call{Event: event, CallID: meta.CallID, From: from.ToNonAD().String(), IsGroup: !meta.GroupJID.IsEmpty(), TS: meta.Timestamp.UnixMilli()}
}

func CallOffer(evt *wevents.CallOffer) events.Call {
	c := call("offer", evt.BasicCallMeta)
	if evt.Data != nil {
		_, c.IsVideo = evt.Data.GetOptionalChildByTag("video")
	}
	return c
}

func CallTerminate(evt *wevents.CallTerminate) events.Call {
	return call("terminate", evt.BasicCallMeta)
}

// contactJIDs separa telefone e LID entre o JID do evento e o alternativo.
func contactJIDs(main types.JID, alt string) (phone, lid string) {
	for _, s := range []string{main.ToNonAD().String(), alt} {
		j, err := types.ParseJID(s)
		if s == "" || err != nil {
			continue
		}
		switch j.Server {
		case types.DefaultUserServer:
			phone = j.ToNonAD().String()
		case types.HiddenUserServer:
			lid = j.ToNonAD().String()
		}
	}
	if phone == "" {
		phone = lid
	}
	return phone, lid
}

func ContactFromAction(evt *wevents.Contact) events.Contact {
	alt := evt.Action.GetPnJID()
	if evt.JID.Server == types.DefaultUserServer {
		alt = evt.Action.GetLidJID()
	}
	phone, lid := contactJIDs(evt.JID, alt)
	name := evt.Action.GetFullName()
	if name == "" {
		name = evt.Action.GetFirstName()
	}
	return events.Contact{JID: phone, LID: lid, Name: name}
}

func ContactFromPushName(evt *wevents.PushName) events.Contact {
	phone, lid := contactJIDs(evt.JID, evt.JIDAlt.String())
	return events.Contact{JID: phone, LID: lid, Notify: evt.NewPushName}
}

const HistoryChunk = 200

func History(msgs []*wevents.Message, pushnames []*waHistorySync.Pushname, progress int, final bool, r Resolver) []events.History {
	contacts := make([]events.Contact, 0, len(pushnames))
	for _, p := range pushnames {
		j, err := types.ParseJID(p.GetID())
		if err != nil || p.GetPushname() == "" {
			continue
		}
		phone, lid := contactJIDs(j, "")
		contacts = append(contacts, events.Contact{JID: phone, LID: lid, Notify: p.GetPushname()})
	}
	translated := make([]events.Message, 0, len(msgs))
	for _, evt := range msgs {
		if m := FromMessage(evt, r).Message; m != nil {
			m.History = true
			translated = append(translated, *m)
		}
	}
	var out []events.History
	for start := 0; start < len(translated) || start == 0; start += HistoryChunk {
		end := min(start+HistoryChunk, len(translated))
		chunk := events.History{Messages: translated[start:end], Contacts: []events.Contact{}, Progress: progress}
		if start == 0 {
			chunk.Contacts = contacts
		}
		out = append(out, chunk)
		if end == len(translated) {
			break
		}
	}
	out[len(out)-1].Final = final
	return out
}

func HistoryLIDMappings(data *waHistorySync.HistorySync) []events.LIDMapping {
	out := make([]events.LIDMapping, 0, len(data.GetPhoneNumberToLidMappings()))
	for _, m := range data.GetPhoneNumberToLidMappings() {
		if m.GetPnJID() != "" && m.GetLidJID() != "" {
			out = append(out, events.LIDMapping{LID: m.GetLidJID(), PN: m.GetPnJID()})
		}
	}
	return out
}
```

Observação: as mensagens do histórico com `Message: nil` (sistema/apagadas) são descartadas por `FromMessage`.

Run: `make test` → PASS.

- [ ] **Step 3: Commit**

```bash
git add internal/translate
git commit -m "feat: tradução de recibos, presença, chamadas, contatos e histórico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sessões e comandos (whatsmeow)

Esta é a única parte que fala com o WhatsApp de verdade; os testes unitários cobrem o que é puro (status, nome do arquivo baixado, mapeamento de erro de download). O resto é conferido no HM na Task 9.

**Files:**
- Create: `internal/session/store.go`, `internal/session/resolver.go`, `internal/session/manager.go`, `internal/session/commands.go`, `internal/session/session_test.go`

**Interfaces:**
- Consumes: `events.Publisher`/`events.New`/tipos (Task 2), `translate.*` (Tasks 3 e 6), `outgoing.*` (Task 5), `media.*` (Task 4).
- Produces (usado pelo `httpapi` na Task 8 através da interface `httpapi.Service`):
  - `var ErrNotFound = errors.New("sessão não encontrada")`, `var ErrNotConnected = errors.New("sessão não conectada")`;
  - `func NewManager(ctx context.Context, db *sql.DB, pub events.Publisher, mediaRoot, logLevel string) (*Manager, error)` (cria o schema, faz `Upgrade` do sqlstore e cria `gateway_sessions`);
  - `func (m *Manager) RestoreAll(ctx context.Context) error`;
  - `func (m *Manager) Connect(ctx context.Context, id int) (Status, error)`;
  - `func (m *Manager) Disconnect(id int) error`, `func (m *Manager) Logout(ctx context.Context, id int) error`;
  - `func (m *Manager) Status(id int) (Status, error)`;
  - `func (m *Manager) PairPhone(ctx context.Context, id int, phone string) (string, error)`;
  - `func (m *Manager) ConnectedCount() (connected, total int)`;
  - `func (m *Manager) Send(ctx context.Context, id int, req outgoing.SendRequest) (SendResult, error)`;
  - `func (m *Manager) Revoke(ctx context.Context, id int, msgID string, ref MessageTarget) error`;
  - `func (m *Manager) Edit(ctx context.Context, id int, msgID, chat, text string) error`;
  - `func (m *Manager) React(ctx context.Context, id int, msgID string, ref MessageTarget, emoji string) error`;
  - `func (m *Manager) MarkRead(ctx context.Context, id int, chat, sender string, ids []string) error`;
  - `func (m *Manager) SetPresence(ctx context.Context, id int, presence string) error`;
  - `func (m *Manager) Typing(ctx context.Context, id int, chat, state string) error`;
  - `func (m *Manager) SubscribePresence(ctx context.Context, id int, chat string) error`;
  - `func (m *Manager) Check(ctx context.Context, id int, numbers []string) ([]NumberCheck, error)`;
  - `func (m *Manager) Avatar(ctx context.Context, id int, jid string) (string, error)`;
  - `func (m *Manager) Group(ctx context.Context, id int, jid string) (GroupInfo, error)`;
  - `func (m *Manager) RejectCall(ctx context.Context, id int, callID, from string) error`;
  - `func (m *Manager) DownloadMedia(ctx context.Context, id int, raw json.RawMessage) (*Downloaded, error)` (nil, nil quando o WhatsApp não tem mais o arquivo);
  - tipos: `Status{State string \`json:"state"\`; Me string \`json:"me,omitempty"\`}` (`state` = `connecting|qr|connected|logged_out`); `SendResult{ExternalID, ChatJID string; Raw json.RawMessage}` (tags `externalId, chatJid, raw`); `MessageTarget{Chat, Sender string; FromMe bool}` (tags `chat, sender, fromMe`); `NumberCheck{Number string; Exists bool; JID string}` (tags `number, exists, jid`); `GroupInfo{Subject, Description string; CreatedAt *time.Time; Participants []Participant}` (tags `subject, description, createdAt, participants`); `Participant{JID, LID, Phone string; IsAdmin, IsMe bool}` (tags `jid, lid, phone, isAdmin, isMe`); `Downloaded{Path, Mimetype, FileName string}` (tags `path, mimetype, fileName`).

- [ ] **Step 1: Testes do que é puro (falham)**

`internal/session/session_test.go`:

```go
package session

import (
	"errors"
	"net/http"
	"testing"

	"go.mau.fi/whatsmeow"
)

func TestExtOf(t *testing.T) {
	cases := map[string]string{"image/jpeg": "jpeg", "audio/ogg; codecs=opus": "ogg", "application/pdf": "pdf", "": "bin", "estranho": "bin"}
	for in, want := range cases {
		if got := extOf(in); got != want {
			t.Fatalf("extOf(%q) = %q, quero %q", in, got, want)
		}
	}
}

func TestMediaGone(t *testing.T) {
	for _, code := range []int{403, 404, 410} {
		err := whatsmeow.DownloadHTTPError{Response: &http.Response{StatusCode: code}}
		if !mediaGone(err) {
			t.Fatalf("%d deveria contar como mídia indisponível", code)
		}
	}
	if mediaGone(errors.New("timeout")) || mediaGone(whatsmeow.DownloadHTTPError{Response: &http.Response{StatusCode: 500}}) {
		t.Fatal("outros erros não são mídia indisponível")
	}
}

func TestTypingState(t *testing.T) {
	for state, ok := range map[string]bool{"composing": true, "recording": true, "paused": true, "dancing": false} {
		_, _, err := typingState(state)
		if (err == nil) != ok {
			t.Fatalf("estado %q: err=%v", state, err)
		}
	}
}
```

Run: `make test` → FAIL.

- [ ] **Step 2: store.go (schema e gateway_sessions)**

`internal/session/store.go`:

```go
package session

import (
	"context"
	"database/sql"
	"errors"

	"go.mau.fi/whatsmeow/types"
)

// ensureSchema cria o schema do gateway; o search_path do DSN já aponta
// para ele, então o sqlstore e gateway_sessions caem lá.
func ensureSchema(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE SCHEMA IF NOT EXISTS whatsmeow`); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS gateway_sessions (
		connection_id INTEGER PRIMARY KEY,
		jid TEXT,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	return err
}

func saveJID(ctx context.Context, db *sql.DB, id int, jid *types.JID) error {
	var v any
	if jid != nil {
		v = jid.String() // com device: o GetDevice procura por ele
	}
	_, err := db.ExecContext(ctx, `INSERT INTO gateway_sessions (connection_id, jid, updated_at) VALUES ($1, $2, now())
		ON CONFLICT (connection_id) DO UPDATE SET jid = EXCLUDED.jid, updated_at = now()`, id, v)
	return err
}

func loadJID(ctx context.Context, db *sql.DB, id int) (types.JID, bool, error) {
	var s sql.NullString
	err := db.QueryRowContext(ctx, `SELECT jid FROM gateway_sessions WHERE connection_id = $1`, id).Scan(&s)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !s.Valid) {
		return types.EmptyJID, false, nil
	}
	if err != nil {
		return types.EmptyJID, false, err
	}
	jid, err := types.ParseJID(s.String)
	return jid, err == nil, err
}

func pairedIDs(ctx context.Context, db *sql.DB) ([]int, error) {
	rows, err := db.QueryContext(ctx, `SELECT connection_id FROM gateway_sessions WHERE jid IS NOT NULL ORDER BY connection_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
```

O JID guardado é o do aparelho **com** device (`5511...:12@s.whatsapp.net`), porque `container.GetDevice` procura por ele. Não usar `ToNonAD()` aqui.

- [ ] **Step 3: resolver.go (LID, nome do grupo com cache, eu)**

`internal/session/resolver.go`:

```go
package session

import (
	"context"
	"sync"
	"time"

	"go.mau.fi/whatsmeow/types"
)

const groupNameTTL = 10 * time.Minute

type groupName struct {
	name string
	at   time.Time
}

// Session implementa translate.Resolver.
func (s *Session) PhoneFor(lid types.JID) types.JID {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	pn, err := s.client.Store.LIDs.GetPNForLID(ctx, lid)
	if err != nil {
		return types.EmptyJID
	}
	return pn
}

func (s *Session) GroupName(chat types.JID) string {
	if v, ok := s.groups.Load(chat.String()); ok {
		if g := v.(groupName); time.Since(g.at) < groupNameTTL {
			return g.name
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	info, err := s.client.GetGroupInfo(ctx, chat)
	if err != nil {
		s.log.Warnf("nome do grupo %s indisponível: %v", chat, err)
		return ""
	}
	s.groups.Store(chat.String(), groupName{name: info.Name, at: time.Now()})
	return info.Name
}

func (s *Session) forgetGroup(chat types.JID) { s.groups.Delete(chat.String()) }

func (s *Session) Me() types.JID {
	if s.client.Store.ID == nil {
		return types.EmptyJID
	}
	return s.client.Store.ID.ToNonAD()
}

func (s *Session) MyName() string { return s.client.Store.PushName }

// lidSeen evita publicar o mesmo par LID↔telefone a cada mensagem.
type lidSeen struct{ m sync.Map }

func (l *lidSeen) first(lid, pn string) bool {
	_, loaded := l.m.LoadOrStore(lid+"|"+pn, struct{}{})
	return !loaded
}
```

- [ ] **Step 4: manager.go (conectar, restaurar, QR, eventos)**

`internal/session/manager.go`:

```go
// Package session mantém as sessões whatsmeow (uma por conexão do Wazzy),
// publica os eventos e executa os comandos.
package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	wevents "go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"

	"whatsmeowapi/internal/events"
	"whatsmeowapi/internal/translate"
)

var (
	ErrNotFound     = errors.New("sessão não encontrada")
	ErrNotConnected = errors.New("sessão não conectada")
)

type Status struct {
	State string `json:"state"` // connecting | qr | connected | logged_out
	Me    string `json:"me,omitempty"`
}

type Manager struct {
	mu        sync.Mutex
	db        *sql.DB
	container *sqlstore.Container
	pub       events.Publisher
	mediaRoot string
	logLevel  string
	log       waLog.Logger
	sessions  map[int]*Session
}

type Session struct {
	id     int
	m      *Manager
	client *whatsmeow.Client
	log    waLog.Logger
	groups sync.Map
	lids   lidSeen
	mu     sync.Mutex
	state  string
}

func NewManager(ctx context.Context, db *sql.DB, pub events.Publisher, mediaRoot, logLevel string) (*Manager, error) {
	if err := ensureSchema(ctx, db); err != nil {
		return nil, fmt.Errorf("schema: %w", err)
	}
	log := waLog.Stdout("gateway", logLevel, true)
	container := sqlstore.NewWithDB(db, "postgres", waLog.Stdout("store", logLevel, true))
	if err := container.Upgrade(ctx); err != nil {
		return nil, fmt.Errorf("upgrade do sqlstore: %w", err)
	}
	return &Manager{db: db, container: container, pub: pub, mediaRoot: mediaRoot, logLevel: logLevel, log: log, sessions: map[int]*Session{}}, nil
}

func (m *Manager) publish(id int, typ string, data any) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := m.pub.Publish(ctx, events.New(typ, id, data)); err != nil {
		m.log.Errorf("conexão %d: evento %s perdido: %v", id, typ, err)
	}
}

func (s *Session) setState(state string) {
	s.mu.Lock()
	s.state = state
	s.mu.Unlock()
}

func (s *Session) status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{State: s.state}
	if s.state == "connected" {
		st.Me = s.Me().String()
	}
	return st
}

// Connect sobe a sessão da conexão; se já está rodando, só devolve o status.
func (m *Manager) Connect(ctx context.Context, id int) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[id]; ok {
		return s.status(), nil
	}
	jid, paired, err := loadJID(ctx, m.db, id)
	if err != nil {
		return Status{}, err
	}
	device := m.container.NewDevice()
	if paired {
		if d, err := m.container.GetDevice(ctx, jid); err == nil && d != nil {
			device = d
		}
	}
	log := waLog.Stdout(fmt.Sprintf("wa-%d", id), m.logLevel, true)
	s := &Session{id: id, m: m, client: whatsmeow.NewClient(device, log), log: log, state: "connecting"}
	s.client.AddEventHandler(s.handle)
	if s.client.Store.ID == nil {
		qr, err := s.client.GetQRChannel(context.Background())
		if err != nil {
			return Status{}, err
		}
		go s.watchQR(qr)
	}
	if err := s.client.Connect(); err != nil {
		return Status{}, fmt.Errorf("conectar %d: %w", id, err)
	}
	m.sessions[id] = s
	return s.status(), nil
}

func (s *Session) watchQR(qr <-chan whatsmeow.QRChannelItem) {
	for item := range qr {
		switch item.Event {
		case whatsmeow.QRChannelEventCode:
			s.setState("qr")
			s.m.publish(s.id, events.TypeConnection, events.Connection{Status: "qr", QR: item.Code})
		case "success":
			// PairSuccess/Connected cuidam do resto.
		default:
			// timeout ou erro: a sessão para; o Wazzy mostra o botão de QR de novo.
			s.m.drop(s.id, s)
			s.client.Disconnect()
			s.m.publish(s.id, events.TypeConnection, events.Connection{Status: "disconnected", Reason: item.Event})
		}
	}
}

func (m *Manager) drop(id int, s *Session) {
	m.mu.Lock()
	if cur, ok := m.sessions[id]; ok && cur == s {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
}

func (m *Manager) RestoreAll(ctx context.Context) error {
	ids, err := pairedIDs(ctx, m.db)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := m.Connect(ctx, id); err != nil {
			m.log.Errorf("restaurar conexão %d: %v", id, err)
		}
	}
	return nil
}

func (m *Manager) get(id int) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	return s, nil
}

func (m *Manager) ready(id int) (*Session, error) {
	s, err := m.get(id)
	if err != nil {
		return nil, err
	}
	if !s.client.IsConnected() || !s.client.IsLoggedIn() {
		return nil, ErrNotConnected
	}
	return s, nil
}

func (m *Manager) Status(id int) (Status, error) {
	s, err := m.get(id)
	if err != nil {
		return Status{}, err
	}
	return s.status(), nil
}

func (m *Manager) ConnectedCount() (connected, total int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		total++
		if s.status().State == "connected" {
			connected++
		}
	}
	return connected, total
}

// Disconnect fecha o socket e mantém o pareamento (o Connect seguinte volta
// sem QR).
func (m *Manager) Disconnect(id int) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	m.drop(id, s)
	s.client.Disconnect()
	return nil
}

// Logout desfaz o pareamento e apaga as chaves.
func (m *Manager) Logout(ctx context.Context, id int) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	m.drop(id, s)
	if s.client.IsLoggedIn() {
		if err := s.client.Logout(ctx); err != nil {
			s.log.Warnf("logout: %v", err)
		}
	}
	s.client.Disconnect()
	if s.client.Store.ID != nil {
		_ = s.client.Store.Delete(ctx)
	}
	if err := saveJID(ctx, m.db, id, nil); err != nil {
		return err
	}
	m.publish(id, events.TypeConnection, events.Connection{Status: "logged_out"})
	return nil
}

func (m *Manager) PairPhone(ctx context.Context, id int, phone string) (string, error) {
	s, err := m.get(id)
	if err != nil {
		return "", err
	}
	code, err := s.client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return "", err
	}
	m.publish(id, events.TypeConnection, events.Connection{Status: "pair_code", Code: code})
	return code, nil
}

func (s *Session) handle(raw any) {
	m := s.m
	switch evt := raw.(type) {
	case *wevents.PairSuccess:
		jid := evt.ID
		if err := saveJID(context.Background(), m.db, s.id, &jid); err != nil {
			s.log.Errorf("salvar pareamento: %v", err)
		}
	case *wevents.Connected:
		s.setState("connected")
		m.publish(s.id, events.TypeConnection, events.Connection{Status: "connected", Me: s.Me().String()})
	case *wevents.Disconnected:
		s.setState("connecting") // o whatsmeow reconecta sozinho
		m.publish(s.id, events.TypeConnection, events.Connection{Status: "disconnected"})
	case *wevents.StreamReplaced:
		// Outro cliente abriu a mesma sessão (ex.: Baileys religado na volta
		// atrás). Não insiste para não derrubar o outro.
		m.drop(s.id, s)
		s.client.Disconnect()
		m.publish(s.id, events.TypeConnection, events.Connection{Status: "disconnected", Reason: "stream_replaced"})
	case *wevents.LoggedOut:
		m.drop(s.id, s)
		ctx := context.Background()
		if s.client.Store.ID != nil {
			_ = s.client.Store.Delete(ctx)
		}
		_ = saveJID(ctx, m.db, s.id, nil)
		s.setState("logged_out")
		m.publish(s.id, events.TypeConnection, events.Connection{Status: "logged_out", Reason: evt.Reason.String()})
	case *wevents.TemporaryBan:
		m.publish(s.id, events.TypeConnection, events.Connection{Status: "disconnected", Reason: evt.String()})
	case *wevents.ClientOutdated:
		m.publish(s.id, events.TypeConnection, events.Connection{Status: "disconnected", Reason: "client_outdated"})
	case *wevents.Message:
		res := translate.FromMessage(evt, s)
		if res.LIDMapping != nil && s.lids.first(res.LIDMapping.LID, res.LIDMapping.PN) {
			m.publish(s.id, events.TypeLIDMapping, *res.LIDMapping)
		}
		switch {
		case res.Message != nil:
			m.publish(s.id, events.TypeMessage, *res.Message)
		case res.Reaction != nil:
			m.publish(s.id, events.TypeReaction, *res.Reaction)
		case res.Update != nil:
			m.publish(s.id, events.TypeMessageUpdate, *res.Update)
		}
	case *wevents.Receipt:
		if r := translate.Receipt(evt); r != nil {
			m.publish(s.id, events.TypeReceipt, *r)
		}
	case *wevents.ChatPresence:
		m.publish(s.id, events.TypePresence, translate.Presence(evt))
	case *wevents.CallOffer:
		m.publish(s.id, events.TypeCall, translate.CallOffer(evt))
	case *wevents.CallTerminate:
		m.publish(s.id, events.TypeCall, translate.CallTerminate(evt))
	case *wevents.Contact:
		m.publish(s.id, events.TypeContacts, events.Contacts{Contacts: []events.Contact{translate.ContactFromAction(evt)}})
	case *wevents.PushName:
		m.publish(s.id, events.TypeContacts, events.Contacts{Contacts: []events.Contact{translate.ContactFromPushName(evt)}})
	case *wevents.GroupInfo:
		s.forgetGroup(evt.JID)
		m.publish(s.id, events.TypeGroupUpdate, events.GroupUpdate{JID: evt.JID.String()})
	case *wevents.JoinedGroup:
		s.forgetGroup(evt.JID)
		m.publish(s.id, events.TypeGroupUpdate, events.GroupUpdate{JID: evt.JID.String()})
	case *wevents.HistorySync:
		s.handleHistory(evt)
	}
}

func (s *Session) handleHistory(evt *wevents.HistorySync) {
	data := evt.Data
	for _, mp := range translate.HistoryLIDMappings(data) {
		if s.lids.first(mp.LID, mp.PN) {
			s.m.publish(s.id, events.TypeLIDMapping, mp)
		}
	}
	var msgs []*wevents.Message
	for _, conv := range data.GetConversations() {
		chat, err := types.ParseJID(conv.GetID())
		if err != nil {
			continue
		}
		for _, hm := range conv.GetMessages() {
			parsed, err := s.client.ParseWebMessage(chat, hm.GetMessage())
			if err == nil {
				msgs = append(msgs, parsed)
			}
		}
	}
	progress := int(data.GetProgress())
	for _, chunk := range translate.History(msgs, data.GetPushnames(), progress, progress >= 100, s) {
		s.m.publish(s.id, events.TypeHistory, chunk)
	}
}
```

- [ ] **Step 5: commands.go**

`internal/session/commands.go`:

```go
package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"whatsmeowapi/internal/media"
	"whatsmeowapi/internal/outgoing"
	"whatsmeowapi/internal/translate"
)

type SendResult struct {
	ExternalID string          `json:"externalId"`
	ChatJID    string          `json:"chatJid"`
	Raw        json.RawMessage `json:"raw"`
}

type MessageTarget struct {
	Chat   string `json:"chat"`
	Sender string `json:"sender,omitempty"`
	FromMe bool   `json:"fromMe,omitempty"`
}

type NumberCheck struct {
	Number string `json:"number"`
	Exists bool   `json:"exists"`
	JID    string `json:"jid,omitempty"`
}

type Participant struct {
	JID     string `json:"jid"`
	LID     string `json:"lid,omitempty"`
	Phone   string `json:"phone,omitempty"`
	IsAdmin bool   `json:"isAdmin"`
	IsMe    bool   `json:"isMe"`
}

type GroupInfo struct {
	Subject      string        `json:"subject"`
	Description  string        `json:"description"`
	CreatedAt    *time.Time    `json:"createdAt"`
	Participants []Participant `json:"participants"`
}

type Downloaded struct {
	Path     string `json:"path"`
	Mimetype string `json:"mimetype"`
	FileName string `json:"fileName"`
}

func parseJID(s string) (types.JID, error) {
	j, err := types.ParseJID(s)
	if err != nil || s == "" {
		return types.EmptyJID, fmt.Errorf("%w: jid %q", outgoing.ErrInvalid, s)
	}
	return j, nil
}

// senderOf: o autor da mensagem alvo; vazio quando fomos nós.
func senderOf(t MessageTarget) (types.JID, error) {
	if t.FromMe || t.Sender == "" {
		return types.EmptyJID, nil
	}
	return parseJID(t.Sender)
}

func (m *Manager) Send(ctx context.Context, id int, req outgoing.SendRequest) (SendResult, error) {
	s, err := m.ready(id)
	if err != nil {
		return SendResult{}, err
	}
	to, err := outgoing.ResolveTo(req.To)
	if err != nil {
		return SendResult{}, err
	}
	msg, err := outgoing.Build(ctx, s.client, m.mediaRoot, req, s.Me())
	if err != nil {
		return SendResult{}, err
	}
	resp, err := s.client.SendMessage(ctx, to, msg)
	if err != nil {
		return SendResult{}, err
	}
	info := types.MessageInfo{MessageSource: types.MessageSource{Chat: to, IsFromMe: true, IsGroup: to.Server == types.GroupServer}, ID: resp.ID, Timestamp: resp.Timestamp}
	return SendResult{ExternalID: resp.ID, ChatJID: to.String(), Raw: translate.Raw(info, msg)}, nil
}

func (m *Manager) Revoke(ctx context.Context, id int, msgID string, t MessageTarget) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	chat, err := parseJID(t.Chat)
	if err != nil {
		return err
	}
	sender, err := senderOf(t)
	if err != nil {
		return err
	}
	_, err = s.client.SendMessage(ctx, chat, s.client.BuildRevoke(chat, sender, msgID))
	return err
}

func (m *Manager) Edit(ctx context.Context, id int, msgID, chatStr, text string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	chat, err := parseJID(chatStr)
	if err != nil {
		return err
	}
	_, err = s.client.SendMessage(ctx, chat, s.client.BuildEdit(chat, msgID, &waE2E.Message{Conversation: proto.String(text)}))
	return err
}

func (m *Manager) React(ctx context.Context, id int, msgID string, t MessageTarget, emoji string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	chat, err := parseJID(t.Chat)
	if err != nil {
		return err
	}
	sender, err := senderOf(t)
	if err != nil {
		return err
	}
	_, err = s.client.SendMessage(ctx, chat, s.client.BuildReaction(chat, sender, msgID, emoji))
	return err
}

func (m *Manager) MarkRead(ctx context.Context, id int, chatStr, senderStr string, ids []string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	chat, err := parseJID(chatStr)
	if err != nil {
		return err
	}
	sender := types.EmptyJID
	if senderStr != "" {
		if sender, err = parseJID(senderStr); err != nil {
			return err
		}
	}
	msgIDs := make([]types.MessageID, len(ids))
	copy(msgIDs, ids)
	return s.client.MarkRead(ctx, msgIDs, time.Now(), chat, sender)
}

func (m *Manager) SetPresence(ctx context.Context, id int, presence string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	if presence != string(types.PresenceAvailable) && presence != string(types.PresenceUnavailable) {
		return fmt.Errorf("%w: presence %q", outgoing.ErrInvalid, presence)
	}
	return s.client.SendPresence(ctx, types.Presence(presence))
}

func typingState(state string) (types.ChatPresence, types.ChatPresenceMedia, error) {
	switch state {
	case "composing":
		return types.ChatPresenceComposing, types.ChatPresenceMediaText, nil
	case "recording":
		return types.ChatPresenceComposing, types.ChatPresenceMediaAudio, nil
	case "paused":
		return types.ChatPresencePaused, types.ChatPresenceMediaText, nil
	}
	return "", "", fmt.Errorf("%w: state %q", outgoing.ErrInvalid, state)
}

func (m *Manager) Typing(ctx context.Context, id int, chatStr, state string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	chat, err := parseJID(chatStr)
	if err != nil {
		return err
	}
	p, media, err := typingState(state)
	if err != nil {
		return err
	}
	return s.client.SendChatPresence(ctx, chat, p, media)
}

func (m *Manager) SubscribePresence(ctx context.Context, id int, chatStr string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	chat, err := parseJID(chatStr)
	if err != nil {
		return err
	}
	return s.client.SubscribePresence(ctx, chat)
}

func (m *Manager) Check(ctx context.Context, id int, numbers []string) ([]NumberCheck, error) {
	s, err := m.ready(id)
	if err != nil {
		return nil, err
	}
	queries := make([]string, 0, len(numbers))
	for _, n := range numbers {
		queries = append(queries, "+"+strings.TrimPrefix(n, "+"))
	}
	resp, err := s.client.IsOnWhatsApp(ctx, queries)
	if err != nil {
		return nil, err
	}
	out := make([]NumberCheck, 0, len(resp))
	for _, r := range resp {
		c := NumberCheck{Number: strings.TrimPrefix(r.Query, "+"), Exists: r.IsIn}
		if r.IsIn {
			c.JID = r.JID.String()
		}
		out = append(out, c)
	}
	return out, nil
}

func (m *Manager) Avatar(ctx context.Context, id int, jidStr string) (string, error) {
	s, err := m.ready(id)
	if err != nil {
		return "", err
	}
	jid, err := parseJID(jidStr)
	if err != nil {
		return "", err
	}
	info, err := s.client.GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{})
	if errors.Is(err, whatsmeow.ErrProfilePictureNotSet) || errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) || info == nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return info.URL, nil
}

func (m *Manager) Group(ctx context.Context, id int, jidStr string) (GroupInfo, error) {
	s, err := m.ready(id)
	if err != nil {
		return GroupInfo{}, err
	}
	jid, err := parseJID(jidStr)
	if err != nil {
		return GroupInfo{}, err
	}
	g, err := s.client.GetGroupInfo(ctx, jid)
	if err != nil {
		return GroupInfo{}, err
	}
	me, myLID := s.Me().User, ""
	if s.client.Store.LID.User != "" {
		myLID = s.client.Store.LID.User
	}
	out := GroupInfo{Subject: g.Name, Description: g.Topic, Participants: make([]Participant, 0, len(g.Participants))}
	if !g.GroupCreated.IsZero() {
		created := g.GroupCreated
		out.CreatedAt = &created
	}
	for _, p := range g.Participants {
		part := Participant{JID: p.JID.String(), IsAdmin: p.IsAdmin || p.IsSuperAdmin}
		if !p.LID.IsEmpty() {
			part.LID = p.LID.String()
		}
		if !p.PhoneNumber.IsEmpty() {
			part.Phone = p.PhoneNumber.User
		}
		part.IsMe = p.PhoneNumber.User == me || (myLID != "" && p.LID.User == myLID) || p.JID.User == me
		out.Participants = append(out.Participants, part)
	}
	return out, nil
}

func (m *Manager) RejectCall(ctx context.Context, id int, callID, fromStr string) error {
	s, err := m.ready(id)
	if err != nil {
		return err
	}
	from, err := parseJID(fromStr)
	if err != nil {
		return err
	}
	return s.client.RejectCall(ctx, from, callID)
}

func extOf(mimetype string) string {
	parts := strings.SplitN(mimetype, "/", 2)
	if len(parts) != 2 || parts[1] == "" {
		return "bin"
	}
	return strings.TrimSpace(strings.SplitN(parts[1], ";", 2)[0])
}

// mediaGone: o WhatsApp não tem mais o arquivo (link velho de figurinha,
// encaminhada antiga). O Wazzy grava a mensagem sem arquivo.
func mediaGone(err error) bool {
	var httpErr whatsmeow.DownloadHTTPError
	if !errors.As(err, &httpErr) || httpErr.Response == nil {
		return false
	}
	code := httpErr.Response.StatusCode
	return code == 403 || code == 404 || code == 410
}

func (m *Manager) DownloadMedia(ctx context.Context, id int, raw json.RawMessage) (*Downloaded, error) {
	s, err := m.ready(id)
	if err != nil {
		return nil, err
	}
	msg := &waE2E.Message{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(raw, msg); err != nil {
		return nil, fmt.Errorf("%w: message inválida", outgoing.ErrInvalid)
	}
	d, info, ok := translate.MediaOf(msg)
	if !ok {
		return nil, fmt.Errorf("%w: mensagem sem mídia", outgoing.ErrInvalid)
	}
	data, err := s.client.Download(ctx, d)
	if mediaGone(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rel, err := media.WriteIncoming(m.mediaRoot, id, extOf(info.Mimetype), data)
	if err != nil {
		return nil, err
	}
	return &Downloaded{Path: rel, Mimetype: info.Mimetype, FileName: info.FileName}, nil
}
```

Run: `make test` → PASS; `make vet` → sem erros.

- [ ] **Step 6: Commit**

```bash
git add internal/session
git commit -m "feat: sessões whatsmeow por conexão, eventos publicados e comandos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: API HTTP, token e main completo

**Files:**
- Create: `internal/httpapi/router.go`, `internal/httpapi/handlers.go`, `internal/httpapi/router_test.go`
- Modify: `cmd/gateway/main.go`, `internal/version/version.go` (só `Name = "wazzy-gateway"`)

**Interfaces:**
- Consumes: os métodos do `session.Manager` (Task 7), `outgoing.ErrInvalid`, `httputil.WriteSuccess/WriteError`.
- Produces: `type Service interface { ... }` com exatamente os métodos públicos do `Manager` listados na Task 7 (exceto `RestoreAll`); `func NewRouter(svc Service, token string) http.Handler`.

Rotas (Go 1.22 `ServeMux`, `{id}` inteiro positivo, senão 400):

| Rota | Método do Service | Corpo → resposta |
|---|---|---|
| `GET /health` (sem token) | `ConnectedCount` | → `{status:"ok", connected, sessions}` |
| `POST /sessions/{id}/connect` | `Connect` | → `Status` |
| `POST /sessions/{id}/disconnect` | `Disconnect` | → `{}` |
| `POST /sessions/{id}/logout` | `Logout` | → `{}` |
| `GET /sessions/{id}` | `Status` | → `Status` |
| `POST /sessions/{id}/pair-phone` | `PairPhone` | `{phone}` → `{code}` |
| `POST /sessions/{id}/messages` | `Send` | `SendRequest` → `SendResult` |
| `DELETE /sessions/{id}/messages/{msgId}` | `Revoke` | `MessageTarget` → `{}` |
| `PUT /sessions/{id}/messages/{msgId}` | `Edit` | `{chat, text}` → `{}` |
| `POST /sessions/{id}/messages/{msgId}/reaction` | `React` | `MessageTarget` + `emoji` → `{}` |
| `POST /sessions/{id}/read` | `MarkRead` | `{chat, sender, ids}` → `{}` |
| `POST /sessions/{id}/presence` | `SetPresence` | `{presence}` → `{}` |
| `POST /sessions/{id}/typing` | `Typing` | `{chat, state}` → `{}` |
| `POST /sessions/{id}/presence/subscribe` | `SubscribePresence` | `{chat}` → `{}` |
| `POST /sessions/{id}/check` | `Check` | `{numbers}` → `[NumberCheck]` |
| `GET /sessions/{id}/avatar?jid=` | `Avatar` | → `{url}` (`url` vazio = sem foto) |
| `GET /sessions/{id}/groups/{jid}` | `Group` | → `GroupInfo` |
| `POST /sessions/{id}/calls/{callId}/reject` | `RejectCall` | `{from}` → `{}` |
| `POST /sessions/{id}/media` | `DownloadMedia` | `{message}` → `Downloaded` ou `null` |

Erros: `session.ErrNotFound` → 404 `session_not_found`; `session.ErrNotConnected` → 409 `not_connected`; `outgoing.ErrInvalid` ou JSON inválido → 400 com a mensagem; resto → 500 com a mensagem. Sem token ou token errado → 401 `unauthorized` (comparação com `crypto/subtle`). Corpo limitado a 1 MB (`http.MaxBytesReader`). Timeout por requisição: 120 s para `/messages` e `/media`, 30 s nas outras (via `context.WithTimeout`).

- [ ] **Step 1: Testes (falham)**

`internal/httpapi/router_test.go`:

```go
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"whatsmeowapi/internal/outgoing"
	"whatsmeowapi/internal/session"
)

type fakeService struct {
	Service // métodos não usados no teste entram em pânico se chamados
	sent    outgoing.SendRequest
	sendErr error
	media   *session.Downloaded
}

func (f *fakeService) ConnectedCount() (int, int) { return 1, 2 }
func (f *fakeService) Connect(ctx context.Context, id int) (session.Status, error) {
	if id == 404 {
		return session.Status{}, session.ErrNotFound
	}
	return session.Status{State: "qr"}, nil
}
func (f *fakeService) Send(ctx context.Context, id int, req outgoing.SendRequest) (session.SendResult, error) {
	f.sent = req
	if f.sendErr != nil {
		return session.SendResult{}, f.sendErr
	}
	return session.SendResult{ExternalID: "ABC", ChatJID: "5511@s.whatsapp.net", Raw: json.RawMessage(`{"key":{}}`)}, nil
}
func (f *fakeService) DownloadMedia(ctx context.Context, id int, raw json.RawMessage) (*session.Downloaded, error) {
	return f.media, nil
}

func do(t *testing.T, h http.Handler, method, path, token, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestHealthWithoutToken(t *testing.T) {
	code, out := do(t, NewRouter(&fakeService{}, "tk"), "GET", "/health", "", "")
	if code != 200 || out["data"].(map[string]any)["connected"].(float64) != 1 {
		t.Fatalf("%d %v", code, out)
	}
}

func TestTokenRequired(t *testing.T) {
	h := NewRouter(&fakeService{}, "tk")
	if code, _ := do(t, h, "POST", "/sessions/1/connect", "", ""); code != 401 {
		t.Fatalf("sem token: %d", code)
	}
	if code, _ := do(t, h, "POST", "/sessions/1/connect", "errado", ""); code != 401 {
		t.Fatalf("token errado: %d", code)
	}
	if code, out := do(t, h, "POST", "/sessions/1/connect", "tk", ""); code != 200 || out["data"].(map[string]any)["state"] != "qr" {
		t.Fatalf("com token: %d %v", code, out)
	}
}

func TestErrorMapping(t *testing.T) {
	h := NewRouter(&fakeService{}, "tk")
	if code, out := do(t, h, "POST", "/sessions/404/connect", "tk", ""); code != 404 || out["error"] != "session_not_found" {
		t.Fatalf("%d %v", code, out)
	}
	if code, _ := do(t, h, "POST", "/sessions/abc/connect", "tk", ""); code != 400 {
		t.Fatalf("id inválido: %d", code)
	}
	svc := &fakeService{sendErr: session.ErrNotConnected}
	if code, out := do(t, NewRouter(svc, "tk"), "POST", "/sessions/1/messages", "tk", `{"to":{"number":"5511"},"content":{"type":"text","text":"oi"}}`); code != 409 || out["error"] != "not_connected" {
		t.Fatalf("%d %v", code, out)
	}
	svc = &fakeService{sendErr: errors.Join(outgoing.ErrInvalid, errors.New("path"))}
	if code, _ := do(t, NewRouter(svc, "tk"), "POST", "/sessions/1/messages", "tk", `{"to":{},"content":{"type":"image","path":"../x"}}`); code != 400 {
		t.Fatalf("pedido inválido: %d", code)
	}
	if code, _ := do(t, h, "POST", "/sessions/1/messages", "tk", `{nao é json`); code != 400 {
		t.Fatalf("json inválido: %d", code)
	}
}

func TestSendDecodesRequest(t *testing.T) {
	svc := &fakeService{}
	body := `{"to":{"number":"5511999990000","lid":"123@lid"},"content":{"type":"text","text":"oi","mentions":["1@lid"]},"quoted":{"id":"Q","fromMe":true,"text":"x"},"forwarded":true}`
	code, out := do(t, NewRouter(svc, "tk"), "POST", "/sessions/1/messages", "tk", body)
	if code != 200 || out["data"].(map[string]any)["externalId"] != "ABC" {
		t.Fatalf("%d %v", code, out)
	}
	if svc.sent.To.LID != "123@lid" || svc.sent.Content.Mentions[0] != "1@lid" || !svc.sent.Quoted.FromMe || !svc.sent.Forwarded {
		t.Fatalf("pedido decodificado errado: %+v", svc.sent)
	}
}

func TestMediaGoneReturnsNull(t *testing.T) {
	code, out := do(t, NewRouter(&fakeService{media: nil}, "tk"), "POST", "/sessions/1/media", "tk", `{"message":{"imageMessage":{}}}`)
	if code != 200 || out["data"] != nil || out["success"] != true {
		t.Fatalf("%d %v", code, out)
	}
}
```

Run: `make test` → FAIL.

- [ ] **Step 2: router.go**

`internal/httpapi/router.go`:

```go
// Package httpapi expõe os comandos do gateway para a api do Wazzy.
package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"whatsmeowapi/internal/httputil"
	"whatsmeowapi/internal/outgoing"
	"whatsmeowapi/internal/session"
)

type Service interface {
	ConnectedCount() (connected, total int)
	Connect(ctx context.Context, id int) (session.Status, error)
	Disconnect(id int) error
	Logout(ctx context.Context, id int) error
	Status(id int) (session.Status, error)
	PairPhone(ctx context.Context, id int, phone string) (string, error)
	Send(ctx context.Context, id int, req outgoing.SendRequest) (session.SendResult, error)
	Revoke(ctx context.Context, id int, msgID string, t session.MessageTarget) error
	Edit(ctx context.Context, id int, msgID, chat, text string) error
	React(ctx context.Context, id int, msgID string, t session.MessageTarget, emoji string) error
	MarkRead(ctx context.Context, id int, chat, sender string, ids []string) error
	SetPresence(ctx context.Context, id int, presence string) error
	Typing(ctx context.Context, id int, chat, state string) error
	SubscribePresence(ctx context.Context, id int, chat string) error
	Check(ctx context.Context, id int, numbers []string) ([]session.NumberCheck, error)
	Avatar(ctx context.Context, id int, jid string) (string, error)
	Group(ctx context.Context, id int, jid string) (session.GroupInfo, error)
	RejectCall(ctx context.Context, id int, callID, from string) error
	DownloadMedia(ctx context.Context, id int, raw json.RawMessage) (*session.Downloaded, error)
}

var errBadID = errors.New("id inválido")

type handler func(w http.ResponseWriter, r *http.Request, id int) (any, error)

func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, session.ErrNotFound):
		httputil.WriteError(w, http.StatusNotFound, "session_not_found")
	case errors.Is(err, session.ErrNotConnected):
		httputil.WriteError(w, http.StatusConflict, "not_connected")
	case errors.Is(err, outgoing.ErrInvalid), errors.Is(err, errBadID), errors.Is(err, errBadJSON):
		httputil.WriteError(w, http.StatusBadRequest, err.Error())
	default:
		httputil.WriteError(w, http.StatusInternalServerError, err.Error())
	}
}

func route(timeout time.Duration, h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || id <= 0 {
			writeErr(w, errBadID)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		data, err := h(w, r.WithContext(ctx), id)
		if err != nil {
			writeErr(w, err)
			return
		}
		httputil.WriteSuccess(w, http.StatusOK, data)
	}
}

func auth(token string, next http.Handler) http.Handler {
	want := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		got := []byte(strings.TrimSpace(r.Header.Get("Authorization")))
		if subtle.ConstantTimeCompare(got, want) != 1 {
			httputil.WriteError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func NewRouter(svc Service, token string) http.Handler {
	h := handlers{svc: svc}
	short, long := 30*time.Second, 120*time.Second
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("POST /sessions/{id}/connect", route(short, h.connect))
	mux.HandleFunc("POST /sessions/{id}/disconnect", route(short, h.disconnect))
	mux.HandleFunc("POST /sessions/{id}/logout", route(short, h.logout))
	mux.HandleFunc("GET /sessions/{id}", route(short, h.status))
	mux.HandleFunc("POST /sessions/{id}/pair-phone", route(short, h.pairPhone))
	mux.HandleFunc("POST /sessions/{id}/messages", route(long, h.send))
	mux.HandleFunc("DELETE /sessions/{id}/messages/{msgId}", route(short, h.revoke))
	mux.HandleFunc("PUT /sessions/{id}/messages/{msgId}", route(short, h.edit))
	mux.HandleFunc("POST /sessions/{id}/messages/{msgId}/reaction", route(short, h.react))
	mux.HandleFunc("POST /sessions/{id}/read", route(short, h.read))
	mux.HandleFunc("POST /sessions/{id}/presence", route(short, h.presence))
	mux.HandleFunc("POST /sessions/{id}/typing", route(short, h.typing))
	mux.HandleFunc("POST /sessions/{id}/presence/subscribe", route(short, h.subscribe))
	mux.HandleFunc("POST /sessions/{id}/check", route(short, h.check))
	mux.HandleFunc("GET /sessions/{id}/avatar", route(short, h.avatar))
	mux.HandleFunc("GET /sessions/{id}/groups/{jid}", route(short, h.group))
	mux.HandleFunc("POST /sessions/{id}/calls/{callId}/reject", route(short, h.rejectCall))
	mux.HandleFunc("POST /sessions/{id}/media", route(long, h.media))
	return auth(token, mux)
}
```

- [ ] **Step 3: handlers.go**

`internal/httpapi/handlers.go`:

```go
package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"whatsmeowapi/internal/httputil"
	"whatsmeowapi/internal/outgoing"
	"whatsmeowapi/internal/session"
)

var errBadJSON = errors.New("corpo JSON inválido")

type handlers struct{ svc Service }

type empty struct{}

func decode(r *http.Request, v any) error {
	if r.ContentLength == 0 {
		return nil
	}
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return fmt.Errorf("%w: %v", errBadJSON, err)
	}
	return nil
}

func (h handlers) health(w http.ResponseWriter, r *http.Request) {
	connected, total := h.svc.ConnectedCount()
	httputil.WriteSuccess(w, http.StatusOK, map[string]any{"status": "ok", "connected": connected, "sessions": total})
}

func (h handlers) connect(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	return h.svc.Connect(r.Context(), id)
}

func (h handlers) disconnect(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	return empty{}, h.svc.Disconnect(id)
}

func (h handlers) logout(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	return empty{}, h.svc.Logout(r.Context(), id)
}

func (h handlers) status(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	return h.svc.Status(id)
}

func (h handlers) pairPhone(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Phone string `json:"phone"` }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if body.Phone == "" {
		return nil, fmt.Errorf("%w: phone obrigatório", outgoing.ErrInvalid)
	}
	code, err := h.svc.PairPhone(r.Context(), id, body.Phone)
	return map[string]string{"code": code}, err
}

func (h handlers) send(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var req outgoing.SendRequest
	if err := decode(r, &req); err != nil {
		return nil, err
	}
	return h.svc.Send(r.Context(), id, req)
}

func (h handlers) revoke(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var t session.MessageTarget
	if err := decode(r, &t); err != nil {
		return nil, err
	}
	return empty{}, h.svc.Revoke(r.Context(), id, r.PathValue("msgId"), t)
}

func (h handlers) edit(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Chat, Text string }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.Edit(r.Context(), id, r.PathValue("msgId"), body.Chat, body.Text)
}

func (h handlers) react(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct {
		session.MessageTarget
		Emoji string `json:"emoji"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.React(r.Context(), id, r.PathValue("msgId"), body.MessageTarget, body.Emoji)
}

func (h handlers) read(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct {
		Chat   string   `json:"chat"`
		Sender string   `json:"sender"`
		IDs    []string `json:"ids"`
	}
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.MarkRead(r.Context(), id, body.Chat, body.Sender, body.IDs)
}

func (h handlers) presence(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Presence string `json:"presence"` }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.SetPresence(r.Context(), id, body.Presence)
}

func (h handlers) typing(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Chat, State string }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.Typing(r.Context(), id, body.Chat, body.State)
}

func (h handlers) subscribe(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Chat string `json:"chat"` }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.SubscribePresence(r.Context(), id, body.Chat)
}

func (h handlers) check(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Numbers []string `json:"numbers"` }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return h.svc.Check(r.Context(), id, body.Numbers)
}

func (h handlers) avatar(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	url, err := h.svc.Avatar(r.Context(), id, r.URL.Query().Get("jid"))
	return map[string]string{"url": url}, err
}

func (h handlers) group(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	return h.svc.Group(r.Context(), id, r.PathValue("jid"))
}

func (h handlers) rejectCall(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ From string `json:"from"` }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	return empty{}, h.svc.RejectCall(r.Context(), id, r.PathValue("callId"), body.From)
}

func (h handlers) media(w http.ResponseWriter, r *http.Request, id int) (any, error) {
	var body struct{ Message json.RawMessage `json:"message"` }
	if err := decode(r, &body); err != nil {
		return nil, err
	}
	if len(body.Message) == 0 {
		return nil, fmt.Errorf("%w: message obrigatório", outgoing.ErrInvalid)
	}
	d, err := h.svc.DownloadMedia(r.Context(), id, body.Message)
	if err != nil || d == nil {
		return nil, err // d == nil: o WhatsApp não tem mais o arquivo → data: null
	}
	return d, nil
}
```

Atenção ao `media`: com `d == nil` e `err == nil`, `route` escreve `data: null` (é o esperado). Os campos dos corpos sem tag JSON (`struct{ Chat, Text string }`) casam com `chat`/`text` porque o `encoding/json` ignora maiúsculas e minúsculas.

- [ ] **Step 4: main completo**

`cmd/gateway/main.go`:

```go
package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"google.golang.org/protobuf/proto"

	"whatsmeowapi/internal/config"
	"whatsmeowapi/internal/events"
	"whatsmeowapi/internal/httpapi"
	"whatsmeowapi/internal/media"
	"whatsmeowapi/internal/session"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	// Nome mostrado em "Aparelhos conectados" no celular.
	store.DeviceProps.Os = proto.String("Wazzy")
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()

	ctx := context.Background()
	db, err := sql.Open("postgres", cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	db.SetMaxOpenConns(10)
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("REDIS_URL: %v", err)
	}
	rdb := redis.NewClient(opt)

	manager, err := session.NewManager(ctx, db, events.NewRedisPublisher(rdb), cfg.MediaRoot, cfg.LogLevel)
	if err != nil {
		log.Fatalf("sessões: %v", err)
	}
	if err := manager.RestoreAll(ctx); err != nil {
		log.Printf("restaurar sessões: %v", err)
	}

	go func() {
		for range time.Tick(time.Hour) {
			if n, err := media.Cleanup(cfg.MediaRoot, 24*time.Hour); err != nil {
				log.Printf("limpeza de mídia: %v", err)
			} else if n > 0 {
				log.Printf("limpeza de mídia: %d arquivos apagados", n)
			}
		}
	}()

	srv := &http.Server{Addr: ":" + cfg.HTTPPort, Handler: httpapi.NewRouter(manager, cfg.GatewayToken), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("gateway em :%s", cfg.HTTPPort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdown, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	log.Println("gateway finalizado")
}
```

`internal/version/version.go`: trocar o `Name` para `"wazzy-gateway"` (manter `Version`).

Run: `make tidy && make vet && make test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: API HTTP do gateway com token e main completo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Conferência no HM com celular real e README

Sem código novo de produto: subir o gateway no HM, parear um número de teste e ver os eventos no Redis. O Wazzy **não** usa o gateway ainda (Plano 3). **Usar um número de teste, nunca o de uma conexão do Wazzy que esteja ligada no Baileys**, para não derrubar a sessão do HM.

**Files:**
- Modify: `README.md` (reescrever)

- [ ] **Step 1: Subir no HM**

```bash
cd /Users/thiagorodrigues/Projetos/sweasy/whatsapp-api
docker compose -f docker-compose.hm.yml up -d --build
docker compose -f docker-compose.hm.yml logs --tail 30 gateway
curl -s localhost:8090/health
```

Esperado: `{"success":true,"data":{"connected":0,"sessions":0,"status":"ok"},"error":null}` e, no Postgres do HM, o schema `whatsmeow` com as tabelas `whatsmeow_*` e `gateway_sessions` (`docker exec whatsapp-api-postgres-1 psql -U sweasy -d sweasy -c '\dt whatsmeow.*'`).

- [ ] **Step 2: Parear e ver os eventos (com o usuário, celular de teste)**

Usar o id `9001` (não existe no Wazzy).

```bash
T='Authorization: Bearer hm-gateway-token'
curl -s -XPOST -H "$T" localhost:8090/sessions/9001/connect
docker exec whatsapp-api-redis-1 redis-cli XREVRANGE wa:events:9001 + - COUNT 1
```

O último evento é `connection` com `status:"qr"`. Gerar a imagem do QR a partir do campo `qr` (ex.: `qrencode -t ansiutf8 '<qr>'` ou um gerador local) e pedir ao usuário para ler no celular de teste. Depois:

- `GET /sessions/9001` → `{"state":"connected","me":"55...@s.whatsapp.net"}`;
- no celular, "Aparelhos conectados" mostra **Wazzy**;
- mandar do celular de **outro** número: texto, imagem, áudio, uma reação, editar uma mensagem, apagar para todos; conferir no stream os tipos `message`, `reaction`, `message` com `editOf`, `message_update`;
- `POST /sessions/9001/messages` com `{"to":{"number":"<outro número>"},"content":{"type":"text","text":"teste do gateway"}}` → chega no outro celular; o outro lê → stream recebe `receipt` com `read`;
- `POST /sessions/9001/media` com o `raw.message` de uma imagem recebida (copiar do stream) → arquivo aparece em `whatsapp-api/public/.gateway/in/`;
- `POST /sessions/9001/typing` `{"chat":"<jid>","state":"composing"}` → outro celular vê "digitando...";
- `docker compose -f docker-compose.hm.yml restart gateway` → a sessão volta sozinha (`connection connected` no stream, sem QR);
- `POST /sessions/9001/logout` → aparelho some do celular, stream recebe `logged_out`.

Anotar no fim do README (seção "Conferido no HM") o que passou e o que não passou. Se algo falhar, corrigir com teste antes (TDD) na task responsável e repetir.

- [ ] **Step 3: README**

Reescrever `README.md` com: o que é o gateway (um parágrafo), variáveis de ambiente (copiar do `.env.example`), tabela de rotas da Task 8, tabela de eventos da spec, como rodar no HM (`docker-compose.hm.yml`), como rodar os testes (`make test`), e a seção "Conferido no HM" com a data e o resultado do Step 2.

- [ ] **Step 4: Commit e parar**

```bash
docker compose -f docker-compose.hm.yml down
git add README.md
git commit -m "docs: README do gateway e conferência no HM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Não dar push. Avisar o usuário que o Plano 1 terminou e que o próximo é o Plano 2 (conversão das sessões).
