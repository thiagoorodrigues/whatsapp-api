# Chaves do Baileys em tabela própria

Data: 2026-09-29 · Repositório: `whatsapp-api`

## Problema

`Whatsapps.session` guarda o estado inteiro do Baileys (creds + todas as chaves
de sinal) num único JSON. Em produção esse JSON tem 1,87 MB. Cada
`Whatsapp.findByPk`/`findOne` sem `attributes` traz esse texto, e dois crons de
minuto fazem isso uma vez por ticket (73 + 57 tickets), o que gera ~2 MB/s
contínuos do Postgres para a API com o servidor ocioso. Cada `creds.update`
regrava o JSON inteiro, e a tabela Whatsapps chegou a 22 MB para 2 linhas.

## Desenho

- Nova tabela `BaileysKeys` com chave primária composta
  (`whatsappId`, `type`, `keyId`) e coluna `value` TEXT com o valor serializado
  por `BufferJSON.replacer`. `type` usa os nomes do Baileys (`pre-key`,
  `session`, `sender-key`, `app-state-sync-key`, `app-state-sync-version`,
  `sender-key-memory`, `lid-mapping`, `device-list`, `tctoken`, `identity-key`).
  FK para Whatsapps com `ON DELETE CASCADE`.
- `Whatsapps.session` passa a guardar só `{ "creds": ... }` (alguns KB).
  O JSON antigo vai para a tabela `WhatsappSessionBackups` (sem modelo Sequelize,
  para nenhum `findByPk` carregá-lo) como rollback; uma migration futura a
  remove depois da validação em produção.
- `authState.ts` lê creds de `session` e monta um `SignalKeyStore` que consulta
  a tabela por (`type`, ids) e grava só as chaves alteradas (`null` apaga).
  A lógica do store fica em `helpers/baileysKeyStore.ts`, sem Sequelize, sobre
  um repositório injetável, para ser testada com um repositório em memória.
- Todo lugar que zera a sessão (`session: ""`) também apaga as chaves do
  `whatsappId`.
- `StartWhatsAppSession` lê o mapeamento LID da tabela em vez de fazer o parse
  do JSON.
- Crons `ClosedAllOpenTickets` e `TransferTicketQueue`: carregam as conexões da
  empresa uma vez, com `attributes`, saem cedo se nenhuma tem expiração ou
  transferência configurada, e só então consultam os tickets dessas conexões.
- Índice em `TicketTraking(ticketId)`.

## Fora do escopo

Debounce de `saveState` (com a tabela, cada gravação já é pequena), gateway em
processo separado (etapa 4), índices além do de TicketTraking, mudanças no app.

## Validação

Em HM: migração converte a sessão existente, o backend sobe e reconecta sem QR,
recebe e envia mensagem, `lid-mapping` continua sendo gravado. Em produção:
tráfego Postgres → API no Monitor do EasyPanel cai de ~2 MB/s para perto de
zero com o sistema ocioso.
