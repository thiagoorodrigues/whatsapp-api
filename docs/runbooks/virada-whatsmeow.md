# Runbook: virada do Baileys para o gateway whatsmeow (produção)

Decisão e desenho: `docs/superpowers/specs/2026-10-10-gateway-whatsmeow-design.md`
(seções "Decisão de 2026-10-11" e "Virada em produção"). Contrato do gateway e
do `migrate-baileys`: README do repositório `weconex-api-meow`.

Resumo: o Wazzy tem a chave `WHATSAPP_ENGINE=baileys|whatsmeow` (padrão
`baileys`). A virada é de uma vez para todas as conexões. Voltar atrás é parar o
gateway, trocar a variável para `baileys` e subir a api. As chaves antigas
(`BaileysKeys` e `Whatsapps.session`) ficam intactas até o Plano 4.

Regra de ouro: **só um cliente por aparelho**. Baileys e gateway ligados na
mesma conta se derrubam (`stream:error conflict replaced`) e as chaves divergem.

Nada deste documento foi executado ainda. Marque cada passo ao fazer.

## 1. Pré-requisitos

### 1.1 Código

- [ ] `whatsapp-api`: branch `feat/wazzy-gateway` revisada e mesclada na `main`.
      **Push na `main` dispara deploy automático da api em produção.** Com
      `WHATSAPP_ENGINE=baileys` (padrão) nada muda, mas só dê o push na hora da
      Fase 1, com o usuário presente.
- [ ] `whatsapp-app`: branch `feat/wazzy-gateway` mesclada na `main` (deploy
      automático do app). Se um push não subir, chamar de novo a URL de deploy do
      hook (`gh api repos/{owner}/{repo}/hooks`); conferir com `curl` numa rota
      nova (401 = no ar, 404 = antigo).
- [ ] `weconex-api-meow` (gateway): `feat/migrate-baileys` mesclada na `main` do
      repositório (`thiagoorodrigues/weconex-api-meow`) e a imagem constrói pelo
      `Dockerfile`. O binário `migrate-baileys` precisa estar na imagem; se não
      estiver, ver 4.3 (container avulso).
- [ ] O repositório `weconex-api-meow` está acessível ao EasyPanel (GitHub).

### 1.2 Redis

O stream do gateway usa `XADD ... MINID ~` (retenção de 3 dias).

- [ ] Versão do Redis de produção é 6.2 ou mais nova. No console do serviço
      `redis` no EasyPanel:

```bash
redis-cli INFO server | grep redis_version
redis-cli CONFIG GET appendonly   # esperado: yes (AOF)
redis-cli CONFIG GET save         # esperado: regras de RDB, não vazio
```

- [ ] Persistência (AOF ou RDB) ligada: sem ela, um restart do Redis perde os
      eventos ainda não lidos.
- [ ] O consumer da api lê o stream dentro de 3 dias; o que ficar mais velho
      some. Nunca deixe a api parada por mais tempo com o gateway ligado.
- [ ] A api roda em **uma única instância** (Swarm com stop-first). Não
      aumentar réplicas: a ordem por conexão do consumer depende disso.

### 1.3 Backups (antes de qualquer mudança)

- [ ] Backup completo do Postgres (`weconex_postgres`, banco `weconex`),
      incluindo as tabelas `BaileysKeys`, `Whatsapps` (coluna `session`) e
      `WhatsappSessionBackups`. Pelo pgweb do serviço `postgres` (botão Open) ou
      `pg_dump` no console do serviço:

```bash
pg_dump -U "$POSTGRES_USER" -d weconex -Fc -f /tmp/weconex-pre-virada.dump
```

- [ ] Copiar o dump para fora da VPS e conferir o tamanho (não vazio).
- [ ] Registrar o estado atual: lista de conexões e status em Conexões e no
      Monitor do servidor (anotar quantas estão `CONNECTED`).

### 1.4 Janela e aviso

- [ ] Escolher janela de baixo movimento (a api fica parada alguns minutos por
      conexão; some mensagens ficam retidas no WhatsApp e chegam depois).
- [ ] Avisar os clientes com antecedência: pode haver breve indisponibilidade e,
      para quem a conversão falhar, será pedido novo QR Code.
- [ ] Ter o celular de teste/número de teste pronto para os testes de fumaça.
- [ ] Ter este runbook e acesso ao EasyPanel (logs só pela UI, sem SSH).

## 2. Fase 1: gateway no ar, sem tráfego

Objetivo: subir o serviço `gateway` e a api nova ainda no Baileys. Nada muda
para os clientes.

### 2.1 Criar o serviço `gateway` no EasyPanel

Projeto `weconex`, novo serviço do tipo App:

- [ ] Fonte: GitHub, repo `thiagoorodrigues/weconex-api-meow`, branch `main`,
      build pelo `Dockerfile`.
- [ ] **Sem domínio** (acesso só pela rede interna do projeto).
- [ ] Porta interna `8080`.
- [ ] Volume compartilhado: montar o **mesmo volume** da api em `/app/public`
      (o gateway grava mídia em `/app/public/.gateway/in` e lê de
      `/app/public/.gateway/out`). O container do gateway roda como root, para
      ter o mesmo dono de arquivos da api.
- [ ] Variáveis de ambiente (modelo: `.env.example` do gateway; **valores só no
      EasyPanel, nunca no Git**):

| Variável | Valor em produção |
|---|---|
| `HTTP_PORT` | `8080` |
| `LOG_LEVEL` | `INFO` |
| `POSTGRES_DSN` | `postgres://USUARIO:SENHA@weconex_postgres:5432/weconex?sslmode=disable` (mesmo banco do Wazzy; o `search_path=whatsmeow` é acrescentado sozinho) |
| `REDIS_URL` | `redis://weconex_redis:6379` (com senha, se houver) |
| `GATEWAY_TOKEN` | token novo e longo (gerar, ex.: `openssl rand -hex 32`); o mesmo valor vai na api |
| `MEDIA_ROOT` | `/app/public` |

- [ ] Deploy do `gateway`. No log da UI deve aparecer `gateway em :8080`.
- [ ] Atenção: o gateway **restaura sozinho** as sessões que existirem em
      `whatsmeow.gateway_sessions`. Neste momento a tabela está vazia, então
      nenhuma sessão sobe. Não rode `migrate-baileys` antes da Fase 2.

### 2.2 Variáveis da api (ainda no Baileys)

No serviço `api`, Environment:

```env
WHATSAPP_ENGINE=baileys
GATEWAY_URL=http://weconex_gateway:8080
GATEWAY_TOKEN=<o mesmo valor do gateway>
GATEWAY_MEDIA_ROOT=/app/public
```

(O nome interno do serviço pode diferir; use o host interno que o EasyPanel
mostra no serviço `gateway`.) Env no EasyPanel só vale depois de clicar
**Deploy**.

- [ ] Deploy da api com o código novo e `WHATSAPP_ENGINE=baileys`.

### 2.3 Verificar a Fase 1

- [ ] Api sobe sem erro e as conexões Baileys continuam `CONNECTED`; enviar e
      receber uma mensagem em uma conexão de teste.
- [ ] Gateway saudável. A partir do console do serviço `api` (rede interna):

```bash
curl -s http://weconex_gateway:8080/health
# {"success":true,"data":{"connected":0,"sessions":0,"status":"ok"},"error":null}
curl -s -o /dev/null -w "%{http_code}\n" http://weconex_gateway:8080/sessions/1
# 401 (sem token), prova que o token é exigido
```

- [ ] Schema `whatsmeow` existe no Postgres (`gateway_sessions` e as tabelas
      `whatsmeow_*`; pgweb).
- [ ] Escrita no volume comum: confirmar que o dono/permissão dos arquivos de
      `/app/public` permite escrita pelos dois serviços (risco do spec).
- [ ] Monitor do servidor: gateway aparece, consumer ainda não relevante
      (engine baileys).

Se algo falhar aqui, nenhum cliente foi afetado: corrija e repita.

## 3. Critérios para seguir

Só inicie a Fase 3 com:

- [ ] Backups prontos e conferidos (1.3).
- [ ] Redis >= 6.2 com persistência (1.2).
- [ ] Gateway saudável e api nova estável no Baileys (2.3).
- [ ] Janela combinada e clientes avisados (1.4).
- [ ] Usuário disponível durante toda a janela.

## 4. Fase 3: janela de virada

### 4.1 Parar a api e garantir que o Baileys não existe mais

- [ ] Anotar o horário e quais conexões estavam `CONNECTED`.
- [ ] No EasyPanel, **parar o serviço `api`** (Stop, não Deploy).
- [ ] Confirmar que nada mais mantém o Baileys conectado:
  - o container antigo da api realmente parou (aba de serviços/Monitor mostra
    sem container ativo da `api`);
  - nenhuma outra cópia do backend usa o mesmo banco (ambiente de teste,
    notebook, HM apontando para a produção, `npm run dev` esquecido). **Um
    processo Node órfão mantém o Baileys vivo e ocioso**: a checagem de 2
    minutos do `migrate-baileys` não o detecta e ele derruba o gateway com
    `conflict replaced` cerca de 3 s após cada login (visto no HM em
    2026-10-11).
- [ ] Aguardar pelo menos 2 minutos depois de parar a api (o `migrate-baileys`
      recusa conexões com escrita do Baileys há menos de 2 minutos).
- [ ] Opcional: no celular de uma conexão de teste, "Aparelhos conectados"
      deve mostrar a conta sem atividade; no log do gateway não deve haver
      `conflict`.

### 4.2 Converter conexão por conexão

Listar as conexões a converter (pgweb ou `psql` no serviço `postgres`):

```sql
SELECT id, name, status, "companyId" FROM "Whatsapps" WHERE provider = 'baileys' ORDER BY id;
```

Para cada `id`, **primeiro `--dry-run`**, depois a gravação:

```bash
migrate-baileys --connection <ID> --dry-run
migrate-baileys --connection <ID>
```

- O `--dry-run` valida device e assinaturas, imprime só contagens (nunca chaves)
  e não grava. Se ele recusar (saída diferente de 0), **não grave**: anote a
  conexão para a lista de QR (seção 8) e siga para a próxima.
- A gravação é uma transação só; se der erro, o banco fica como antes.
- Se recusar por atividade recente (saída 1): conferir de novo 4.1 (processo
  órfão). Só use `--force` se tiver certeza de que o Baileys está parado.
- Se recusar porque o aparelho já está no store (saída 3): só use `--replace`
  se o gateway **ainda não conversou** com essa conexão (refazer a conversão),
  ou se voltou para o Baileys antes.
- Registrar o resumo de cada conexão (contagens, avisos de status diferente de
  `CONNECTED`).

### 4.3 Como rodar o CLI em produção

Opção A (preferida): console do serviço `gateway` no EasyPanel, se a imagem
inclui o binário (`/app/migrate-baileys` ou no `PATH`). O container já tem
`POSTGRES_DSN`. **Atenção:** o gateway restaura sozinho as sessões de
`gateway_sessions` ao subir; como a gravação cria essa linha, **não reinicie o
`gateway` depois das gravações antes da api estar com `whatsmeow`**. (Se o
gateway reiniciar com a api ainda parada, ele só conecta o que foi convertido;
não há Baileys rodando, então não há conflito; ainda assim, prefira não
reiniciar.)

Opção B: container avulso com o mesmo DSN, a partir de uma máquina com Docker
que alcance o Postgres de produção (a VPS não tem SSH; se o Postgres não for
alcançável de fora, use a opção A). Gerar o binário no repositório do gateway:

```bash
cd weconex-api-meow
make build-migrate      # gera bin/migrate-baileys (Linux)
docker run --rm -v "$PWD/bin":/b -e POSTGRES_DSN='postgres://...' alpine:3.22 \
  /b/migrate-baileys --connection <ID> --dry-run
```

Não coloque o DSN real em arquivo versionado nem no histórico compartilhado.

### 4.4 Virar a api para o whatsmeow

No serviço `api`, Environment:

```env
WHATSAPP_ENGINE=whatsmeow
GATEWAY_URL=http://weconex_gateway:8080
GATEWAY_TOKEN=<o mesmo do gateway>
GATEWAY_MEDIA_ROOT=/app/public
```

- [ ] Clicar **Deploy** (iniciar o serviço `api` com a variável nova). Com
      `whatsmeow` a api não inicia nenhum socket Baileys: ela chama `connect`
      para cada conexão ativa e consome os eventos de `wa:events:{id}`.
- [ ] Só uma instância da api rodando.

### 4.5 Verificar no Monitor do servidor

Configurações, Monitor do servidor:

- [ ] Gateway: ok.
- [ ] Todas as conexões esperadas aparecem `connected` (as que falharam na
      conversão pedem QR; ver seção 8).
- [ ] Consumer do stream rodando; atraso (lag) próximo de 0 (alerta só passa de
      1 h, mas deve ser segundos).
- [ ] `wa:dead` igual a 0 (eventos na fila de falhas geram alerta).
- [ ] Logs da `api` e do `gateway` (EasyPanel, conferir horário BRT e recarregar
      em tela cheia, pois o visualizador mistura o container anterior): sem
      `conflict replaced`, sem erro de decifragem em loop.

### 4.6 Testes de fumaça (com o celular de teste e uma conexão real)

- [ ] Receber: mensagem de texto, imagem e áudio de contato chegam no ticket
      (privado e grupo).
- [ ] Enviar: texto pelo painel chega no celular, com ACK avançando (enviada,
      entregue, lida).
- [ ] Mídia: imagem recebida baixa e aparece; enviar imagem, áudio e documento.
- [ ] Reação, edição e apagar para todos (recebimento e envio).
- [ ] "Digitando" nos dois sentidos e marcar como lida (zera não lidas).
- [ ] Nota interna não vai ao WhatsApp.
- [ ] Reiniciar o serviço `gateway` pela UI: publica `disconnected (shutdown)`
      e a sessão volta sozinha, sem QR.

Anotar qualquer divergência; o que importa para decidir a volta atrás está na
seção 5.

## 5. Critérios de volta atrás

Voltar para o Baileys se, nas primeiras horas, ocorrer qualquer um:

- Várias conexões não conectam ou caem em loop depois da conversão (e não são
  só QR pontual de poucos clientes).
- Falha de decifragem generalizada (mensagens não chegam ou chegam ilegíveis).
- `conflict replaced` recorrente sem causa identificada (checar primeiro
  processo órfão e duas instâncias da api).
- `wa:dead` crescendo ou lag subindo sem parar.
- Envio falhando de forma geral, ou bloqueio/aviso de ban da Meta.
- Perda de mensagens comprovada.

Falhas isoladas (uma conexão pedindo QR, uma mídia específica) **não** são
motivo de volta atrás: tratar caso a caso (seção 8).

## 6. Procedimento de volta atrás

A ordem importa: dois clientes no mesmo aparelho se derrubam e corrompem as
chaves.

1. [ ] **Parar o serviço `gateway` primeiro** (Stop no EasyPanel) e confirmar
   que parou (log `gateway finalizado`, sem container ativo).
2. [ ] No serviço `api`, Environment: `WHATSAPP_ENGINE=baileys`
   (`GATEWAY_URL` pode ficar).
3. [ ] **Deploy** da api. Ela restaura as conexões pelo Baileys com
   `BaileysKeys` e `Whatsapps.session`, que não foram alteradas.
4. [ ] Conferir no Monitor e nas Conexões: conectadas; enviar/receber uma
   mensagem de teste.
5. [ ] Conexões que já conversaram pelo gateway por um tempo: o estado dos
   ratchets avançou no whatsmeow, e o Baileys pode ter de renegociar sessões
   (o WhatsApp renegocia sozinho). Se alguma não reconectar, pedir QR.
6. [ ] Mensagens que chegaram só pelo gateway ficam no stream; o consumer não as
   lê com `baileys`. Elas ficam no histórico do ticket já gravado; o que não foi
   consumido pode ser perdido. Registrar o horário da virada e da volta.
7. [ ] Avisar clientes afetados. Para nova tentativa depois, antes de converter
   de novo: `migrate-baileys --connection <ID> --replace` (só com o gateway
   parado e a api no Baileys).

## 7. Pós-virada

- [ ] Acompanhar por alguns dias: Monitor (gateway ok, lag, `wa:dead`),
      conexões `connected`, relatos de clientes, uso de disco do volume comum
      (a pasta `.gateway/{in,out}` é limpa após 24 h) e do Redis.
- [ ] Conferir diariamente que o consumer não ficou parado (a retenção do stream
      é de 3 dias).
- [ ] Depois de alguns dias estáveis, **Plano 4**: remover o código do Baileys
      da api e criar a migration que remove `BaileysKeys`, `Whatsapps.session`
      e `WhatsappSessionBackups`. **Só depois de confirmar produção estável**,
      porque essas tabelas são o caminho de volta atrás. Fazer um backup final
      antes de dropar.
- [ ] Remover do runbook e do EasyPanel o que sobrar do Baileys.

## 8. Problemas conhecidos

- **`stream:error conflict replaced`**: dois clientes na mesma conta. Causas:
  processo Node órfão com Baileys, segunda instância da api, ambiente de teste
  apontando para o mesmo banco/aparelho, gateway e Baileys juntos. Parar o
  intruso; se as chaves divergiram, refazer a conversão (`--replace`, com tudo
  parado) ou pedir QR.
- **Conexão cuja conversão falhou**: o cliente precisa ler um novo QR Code.
  Manter a lista dessas conexões e avisar só esses clientes. Para parear de
  novo pelo gateway: `POST /sessions/{id}/connect` (evento `connection` com
  `qr`) pelo fluxo normal de Conexões do painel.
- **Conexão ainda no estado `CONNECTED` no Wazzy mas sem sessão no gateway**
  (ou o contrário): conferir `GET /sessions/{id}` (404 `session_not_found`
  significa que não está rodando) e reconectar pelo painel.
- **Duplicidade de eventos**: se o Redis cair, o gateway não confirma ao
  WhatsApp e ele reentrega; o consumer deduplica pelo `id`.
- **Chat/sender em LID**: recibos, reações e presença chegam com
  `...@lid`; o lado Node casa pelo LID também. Contatos sem telefone conhecido
  mostram o LID.
- **Edição de mensagem com mídia citada**: a citação de mídia mostra o texto
  (limitação do envio de citação pelo gateway; ver README do gateway e o
  spec).
- **Recebimento de contato com sessão/sender key convertida** em privado e
  grupo ficou sem teste no HM (faltou segundo telefone): é o primeiro item a
  observar na fumaça real (4.6).
- **Nomes de grupo**: se não puderem ser buscados, a mensagem chega com
  `chat.name` vazio e o nome aparece depois (cache de 5 e 10 minutos).
- **Grupos antigos sem hífen**: o gateway resolve pelo JID da lista de grupos
  da sessão (cache de 10 minutos), como o BaileysChannel.
- **Reações, edição, digitando, nota interna, não lidas e histórico** nunca
  tiveram teste com WhatsApp real em produção: conferir na fumaça.
- **Histórico importado**: grava sem disparar automações (comportamento do
  `inbound.history`); lotes grandes demoram.
- **Permissão no volume comum**: o gateway roda como root para igualar o dono
  dos arquivos da api; se mídia não aparecer, conferir dono/permissão em
  `/app/public/.gateway`.
- **Redis**: versão menor que 6.2 impede publicar eventos (`MINID`); sem
  persistência, restart perde eventos não lidos.
- **Env no EasyPanel** só vale após clicar Deploy; deploy sem commit novo não
  refaz build (irrelevante aqui, a api só lê variáveis em runtime).

## 9. Checklist final

Antes:
- [ ] Merges na `main` conferidos, imagem do gateway constrói
- [ ] Redis >= 6.2 com AOF/RDB
- [ ] Backup do Postgres feito e copiado para fora
- [ ] Janela e clientes avisados
- [ ] Token do gateway gerado, igual no gateway e na api

Fase 1:
- [ ] Serviço `gateway` no ar, sem domínio, volume comum, `/health` ok
- [ ] Api nova com `WHATSAPP_ENGINE=baileys` estável

Janela:
- [ ] Api parada; nenhum processo/container com Baileys; 2 minutos de espera
- [ ] `--dry-run` e gravação por conexão; lista de QR anotada
- [ ] `WHATSAPP_ENGINE=whatsmeow` + `GATEWAY_URL`, deploy da api
- [ ] Monitor: gateway ok, conexões conectadas, lag ~0, `wa:dead` 0
- [ ] Fumaça: receber, enviar, ACK, mídia, reação, edição, digitando, lida
- [ ] Clientes com QR pendente avisados

Depois:
- [ ] Acompanhamento por dias sem alertas
- [ ] Decisão de seguir para o Plano 4 (remover Baileys e chaves antigas)
