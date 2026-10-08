# Monitor do servidor — design

Data: 2026-10-08

## Objetivo

Uma página no painel para o super admin ver, sem abrir o EasyPanel, como está a
VPS de produção: principalmente **memória, load, espaço em disco e CPU**, além da
saúde do Postgres, Redis, filas e conexões do WhatsApp, com histórico das
últimas 24 h e destaque visual quando algo passa do limite.

Não há SSH na VPS; tudo é lido de dentro do container da API.

## Fora do escopo

- Consumo por container (Postgres, app, Redis) — só o total da máquina e o
  container da API.
- Avisos externos (WhatsApp, e-mail). O alerta é só na página e no menu.
- Limites configuráveis pela tela (ficam como constantes).

## Fonte dos números (dentro do container)

| Métrica | Fonte | Observação |
|---|---|---|
| CPU da máquina (%) | `/proc/stat`, diferença entre duas leituras | `/proc/stat` no container mostra a VPS |
| Load 1/5/15 | `os.loadavg()` | da VPS; referência = `os.cpus().length` |
| Memória da máquina | `/proc/meminfo` (`MemTotal`, `MemAvailable`) | usado = total − disponível |
| Memória do container da API | `/sys/fs/cgroup/memory.current` (cgroup v2), senão `process.memoryUsage().rss` | |
| Disco | `fs.statfs` em `public/` (volume `/app/public`) | o volume fica no disco da VPS |
| Tempo no ar | `process.uptime()` e `os.uptime()` | API e VPS |

Fora do Linux (HM no Mac) `/proc` não existe: CPU vem de `os.cpus()` e memória de
`os.totalmem()/os.freemem()`. O serviço nunca lança erro por métrica ausente —
ela volta `null` e a tela mostra "—".

## API (whatsapp-api)

### Tabela `ServerMetrics`

`id`, `cpuPercent`, `load1`, `load5`, `load15`, `memUsedBytes`, `memTotalBytes`,
`apiMemBytes`, `diskUsedBytes`, `diskTotalBytes`, `createdAt`. Índice em
`createdAt`. Migration nova.

### Serviços (`src/services/ServerMonitorServices/`)

- `ReadServerMetrics` — lê a tabela acima na hora (CPU: duas amostras de
  `/proc/stat` com 500 ms de intervalo). Puro, sem banco.
- `CheckServicesHealth` — Postgres (`SELECT 1` com tempo, tamanho do banco via
  `pg_database_size`), Redis (`PING` com tempo), filas Bull de `src/queues.ts`
  (`getJobCounts`: waiting, active, delayed, failed; e falhas da última hora
  por `getFailed`). O Redis é testado com `PING` no cliente da própria fila. Cada verificação com
  timeout de 3 s; falha vira `{ ok: false, error }`, não derruba a resposta.
- `ListConnectionsStatus` — todas as `Whatsapps` de todas as empresas: nome,
  empresa, `status`, `updatedAt`. Agrupa em conectadas / outras.
- `RecordServerMetrics` — chama `ReadServerMetrics` e grava uma linha.
- `PurgeServerMetrics` — apaga linhas com mais de 7 dias.
- `evaluateAlerts(snapshot, health, connections)` — função pura que devolve a
  lista de alertas `{ key, level: "warning" | "critical", message }`.

### Limites (constantes em um arquivo só)

- Memória da máquina e disco: aviso ≥ 85%, crítico ≥ 95%.
- CPU: aviso ≥ 85%, crítico ≥ 95% (na média dos últimos 5 minutos do histórico,
  para um pico isolado não acender).
- Load 5 min: aviso ≥ nº de vCPUs, crítico ≥ 2× nº de vCPUs.
- Postgres ou Redis sem resposta: crítico.
- Fila com job que falhou na última hora: aviso (falhas antigas guardadas pelo
  Bull não acendem).
- Conexão do WhatsApp que não está `CONNECTED`: aviso (lista quais).

### Cron (`src/server.ts`)

- `* * * * *` → `RecordServerMetrics` (com try/catch, como os existentes).
- `45 3 * * *` → `PurgeServerMetrics`.

### Rotas (`isAuth`, `isSuper`)

- `GET /server-monitor` → `{ now: snapshot, services, connections, alerts,
  uptime: { api, host } }`.
- `GET /server-monitor/history?hours=24` → linhas da tabela (máx. 168 h),
  amostradas para no máximo ~300 pontos.
- `GET /server-monitor/alerts` → só `{ count, level }`, leve, para o menu.

## Painel (whatsapp-app)

- Componente novo `src/components/ServerMonitor/`, aberto como seção `monitor`
  de `src/pages/SettingsCustom` (rota `/settings/monitor`, mesmo padrão de
  `/settings/logs`, na lista `SUPER_ONLY`). Item "Monitor do servidor" no
  submenu de Configurações em `MainListItems.js`, dentro do bloco
  `user.super`, ao lado de "Logs do sistema". Só super admin.
- **Topo:** faixa de alertas (vermelha se houver crítico, amarela se só aviso;
  some quando está tudo bem).
- **Cartões:** CPU, Memória, Load, Disco — valor grande, barra colorida
  (verde/amarelo/vermelho pelos limites), detalhe pequeno (ex.: "5,1 de 7,7 GB";
  "1,2 · 0,9 · 0,8 de 4 vCPUs"; memória do container da API no cartão de
  memória).
- **Gráfico 24 h:** linhas de CPU %, memória % e disco %, e load em outro gráfico
  pequeno; usa a biblioteca de gráficos que o Dashboard já usa.
- **Serviços:** Postgres (latência, tamanho do banco), Redis (latência), tempo no
  ar da API e da VPS, tabela das filas.
- **WhatsApp:** contagem conectadas/caídas e lista das caídas (empresa, nome,
  status, desde quando).
- Atualiza a cada 30 s (e botão "Atualizar"). O histórico recarrega a cada 5 min.
- **Menu:** ponto vermelho/amarelo no item "Monitor do servidor" e em
  "Configurações", consultando `/server-monitor/alerts` a cada 60 s, só para
  super admin.

## Erros

- Métrica indisponível → `null` → "—" no cartão, sem alerta.
- Falha da rota → mensagem padrão do painel com protocolo (já existe pelos
  Logs do sistema).
- Falha do cron → `logger.error`, que já vai para `SystemLogs`.

## Testes

- `evaluateAlerts`: cada limite (abaixo, aviso, crítico), serviço fora,
  conexão caída, métrica `null` não gera alerta.
- Parser de `/proc/stat` e `/proc/meminfo` com textos de exemplo.
- Amostragem do histórico (≤ 300 pontos, ordem preservada).
- Rotas: 401 sem login, 403 para não super.
- Conferência visual no HM (Mac: números via fallback do `os`) e, depois de
  publicado, em produção.
