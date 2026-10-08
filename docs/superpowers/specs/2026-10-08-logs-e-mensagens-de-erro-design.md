# Logs do sistema e mensagens de erro reais

Data: 2026-10-08
Status: aguardando revisão

## Objetivo

Hoje, quando algo falha, o painel mostra "Desculpe, algo deu errado..." e ninguém sabe
o que aconteceu nem onde (ex.: "Testar agente" do Samuel em produção). Esta entrega:

1. troca a mensagem genérica por mensagens reais de retorno;
2. grava em banco o que acontece no sistema (requisições, erros da API, erros em
   segundo plano e erros do navegador) e mostra tudo numa página "Logs do sistema",
   dentro de Configurações, só para o super admin.

Sucesso = um erro em qualquer tela mostra uma mensagem que diz o que houve (ou um
protocolo), e o super admin acha esse protocolo na página de logs com rota, empresa,
usuário e detalhe técnico.

## Decisões do usuário

- Acesso à página: **só super admin** (`user.super`), todas as empresas.
- Registrar: **erros da API, erros em segundo plano, erros do navegador e todas as
  requisições**.
- Retenção: **info 7 dias; avisos e erros 30 dias**, limpeza diária.
- Local: submenu **Configurações → Logs do sistema** (`/settings/logs`).
- Armazenamento: tabela no Postgres do próprio Wazzy (Sentry e arquivos descartados).

## Dados — tabela `SystemLogs`

| coluna | tipo | observação |
|---|---|---|
| id | BIGSERIAL | |
| createdAt | timestamptz | índice |
| level | varchar(8) | `info`, `warn`, `error`; índice com createdAt |
| source | varchar(8) | `api`, `job`, `web` |
| protocol | varchar(8) | só em avisos/erros; 6 caracteres sem ambíguos (ex. `K7Q2M9`); índice |
| companyId | int null | índice; sem FK (log sobrevive à exclusão da empresa) |
| userId | int null | sem FK |
| method | varchar(8) null | |
| route | varchar(255) null | caminho sem query string, IDs mantidos |
| status | smallint null | |
| durationMs | int null | |
| code | varchar(80) null | ex. `ERR_AI_KEY_UNREADABLE` |
| message | text | resumo legível, até 1000 caracteres |
| detail | text null | pilha do erro, até 8 KB |
| context | jsonb null | dados extras mascarados, até 4 KB serializado |

Migration nova em `src/database/migrations`. Modelo `SystemLog` (sequelize-typescript),
`updatedAt: false`.

## API (`whatsapp-api`)

### Gravação — `src/libs/systemLog.ts`

- `recordLog(entry)`: coloca na fila em memória; descarga com `bulkCreate` a cada 2 s
  ou ao chegar em 200 itens. Fila limitada a 5.000 itens (excedente descartado, com
  contagem no próximo lote como aviso). Falha ao gravar só vai para o console; nunca
  derruba a requisição nem gera novo log (sem recursão).
- `newProtocol()`: 6 caracteres de `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.
- `mask(value)`: percorre objetos e troca por `***` valores de chaves que casem com
  `/pass|senha|token|secret|authorization|api[-_]?key|cookie/i`; corta textos longos.
- Descarga também no `SIGTERM` (deploy) antes de encerrar.

### Requisições — middleware `requestLog`

Registrado logo depois do `cookieParser`. No `res.on("finish")` grava
`level=info` (ou `warn` para 4xx), `source=api`, método, rota, status, tempo,
`companyId`/`userId` de `req.user` quando houver.
Ignora: `/public/*`, `/socket.io/*`, `GET /` (status), `OPTIONS`, e as próprias rotas
`/system-logs*` (para a página não registrar a si mesma a cada 10 s).
Erros (4xx/5xx) não duplicam: o middleware pula quando o tratador de erro já gravou
(`res.locals.logged`).

### Tratador de erros (`app.ts`)

- `AppError`: grava `warn` com `code`, mensagem, rota, corpo da requisição mascarado no
  `context`; resposta continua `{ error: code }`.
- Erro inesperado: grava `error` com pilha e corpo mascarado; resposta passa a ser
  `500 { error: "ERR_INTERNAL", protocol }`.
- Multer: igual hoje, mais registro `warn`.

### Segundo plano

- `logger` (pino) ganha `hooks.logMethod`: chamadas `logger.error` (e `logger.warn`)
  fora de requisição também viram registro `source=job`, com a mensagem e, se houver,
  o `Error` (pilha). Assim filas de mensagens, agendamentos, campanhas, follow-up,
  agente de IA e conexão do WhatsApp entram sem mexer em cada ponto.
  O tratador de erros da API grava direto e não usa esse caminho (sem duplicar).
- `process.on("unhandledRejection")` e `("uncaughtException")` gravam `error`.
- Filas Bull: `on("failed")` em todas as filas de `queues.ts` grava `error` com nome
  da fila e id do job.

### Navegador

`POST /system-logs/client` (`isAuth`): recebe `{ message, detail, url, kind }`,
grava `source=web`, `level=error`, protocolo novo, devolve `{ protocol }`.
Limite: 30 registros por usuário por minuto (em memória); acima disso responde 204
sem gravar.

### Consulta (só super) — `isAuth` + `isSuper`

- `GET /system-logs?level&source&companyId&status&search&from&to&pageNumber`
  (50 por página, mais recentes primeiro). `search` procura em protocolo, código,
  rota e mensagem (ILIKE). Retorna também o nome da empresa e do usuário.
- `GET /system-logs/summary`: últimas 24 h — total de erros, avisos, requisições e
  tempo médio das requisições.

### Limpeza

Job diário (padrão das filas existentes, 03:30): apaga `info` com mais de 7 dias e
`warn`/`error` com mais de 30 dias.

### Mensagens de erro da API

- `secretBox.decryptSecret` falhando ao ler a chave do agente vira
  `AppError("ERR_AI_KEY_UNREADABLE")` em `agentKey`.
- Os textos dos códigos ficam no painel (abaixo).

## Painel (`whatsapp-app`)

### `toastError`

Ordem de decisão:
1. sem resposta (`!err.response`): `ECONNABORTED`/timeout → "O servidor demorou demais
   para responder. Tente de novo em instantes."; outros → "Sem resposta do servidor.
   Verifique sua conexão ou tente de novo em instantes." Grava log `web` (sem toast
   extra).
2. código com tradução em `backendErrors` → texto traduzido (como hoje, incluindo
   `ERR_CODE: detalhe`).
3. `ERR_INTERNAL` → "Erro interno no servidor (protocolo K7Q2M9). Se continuar, envie
   esse protocolo ao suporte."
4. texto que não é código (`AppError` escrito em português) → o próprio texto.
5. código sem tradução → "Erro: ERR_X (status N)".
6. sem nada → "Erro inesperado (status N)".

O texto genérico atual deixa de existir.

### Traduções

Adicionar em `backendErrors` (pt, en, es) os 24 códigos que hoje não têm texto
(lista levantada em 2026-10-08: CONTACT_NOT_FIND, ERR_CANNOT_DELETE_COMPANY_SUPER,
ERR_FLOW_INVALID_GRAPH, ERR_FLOW_INVALID_NODE, ERR_FLOW_NOT_FOUND, ERR_INVALID_DATE,
ERR_NO_BAILEYS_DATA_FOUND, ERR_NO_CAMPAIGN_FOUND, ERR_NO_COMPANY_FOUND,
ERR_NO_CONTACTLISTITEM_FOUND, ERR_NO_CONTACTLISTITEM_SELECTED, ERR_NO_CONTACTLIST_FOUND,
ERR_NO_DIALOG_FOUND, ERR_NO_MESSAGE_FOUND, ERR_NO_PLAN_FOUND, ERR_NO_QUICKMESSAGE_FOUND,
ERR_NO_SCHEDULE_FOUND, ERR_NO_TAG_FOUND, ERR_NO_TICKETNOTE_FOUND, ERR_QUEUE_NOT_FOUND,
ERR_TICKET_NOT_GROUP, ERR_TOO_MANY_CONTACTLISTITEMS, ERR_WAPP_NUMBER_IN_USE,
MESSAGE_NOT_FIND), mais `ERR_INTERNAL` e `ERR_AI_KEY_UNREADABLE`.
Um teste compara os códigos usados na API com as chaves de `pt.js` para não voltar a
faltar.

### Pontos que fogem do `toastError`

Os 4 `toast.error(err.message)` / `toast.error(e)` (ex. `SettingsCustom`) passam a
usar `toastError`.

### Erros do navegador

- `ErrorBoundary` envolvendo as rotas logadas: no lugar da tela branca, um cartão
  "Algo deu errado nesta tela" com o protocolo e botões Recarregar / Voltar ao início.
- `window.onerror` e `unhandledrejection` enviam para `/system-logs/client`
  (no máximo 1 envio por mensagem igual a cada 30 s).

### Página "Logs do sistema" (`/settings/logs`)

- `SettingsCustom`: seção `logs` em `SECTIONS`, incluída em `SUPER_ONLY`.
- Menu: item "Logs do sistema" no submenu Configurações, visível só para super.
- Topo: 4 contadores (erros, avisos, requisições, tempo médio — 24 h).
- Filtros: período (padrão: última hora), nível, origem, empresa, status, busca
  (protocolo, código, rota, mensagem); botão "Atualizar automaticamente" (10 s).
- Lista: hora, nível (chip colorido), origem, empresa, usuário, método + rota,
  status, tempo, mensagem; paginação "carregar mais".
- Clique na linha: painel lateral com tudo, inclusive `detail` e `context`
  formatados, e botão copiar.
- Segue o padrão visual atual (cards, tokens do tema).

## Testes

- API: `mask`, `newProtocol`, fila/descarga em lote (com falha de gravação),
  middleware (ignorados, 4xx sem duplicar), tratador de erro (`ERR_INTERNAL` +
  protocolo), limpeza, rota `client` (limite por minuto), consulta só para super.
- Painel: `toastError` (cada caso da ordem acima), teste de cobertura de traduções.
- HM: provocar um erro 500, um 4xx, um erro de tela e um erro de fila; achar cada um
  pelo protocolo na página.

## Fora do escopo

- Alertas (e-mail/WhatsApp) quando surgir erro.
- Gráficos históricos e exportação.
- Logs para admin de empresa.
