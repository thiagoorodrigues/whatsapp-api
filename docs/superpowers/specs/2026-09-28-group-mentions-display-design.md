# Marcações recebidas com nome (parte 1)

Data: 2026-09-28 · Repositórios: `whatsapp-api` e `whatsapp-app`

## Objetivo

Quando alguém é marcado num grupo, o ticket mostra `@Maria` destacado, como no
WhatsApp, em vez de `@140716097450191`. Quem atende precisa saber quem é quem sem
decorar números.

Fora do escopo: marcar alguém ao escrever (parte 2, especificação própria) e
cadastrar como contato todos os participantes dos grupos (descartado: a lista de
participantes não traz nome, geraria milhares de contatos sem uso e guardaria
dados de quem nunca falou com a empresa).

## Como o WhatsApp manda uma marcação

O texto chega com `@<dígitos>`, que é o número (`5511…`) ou o LID (`140716…`).
A lista de quem foi marcado vem em `contextInfo.mentionedJid` (`5511…@s.whatsapp.net`
ou `140716…@lid`). O nome não vem. Hoje essa lista já fica salva em
`Messages.dataJson` (a mensagem bruta), mas ninguém a lê.

## De onde vem o nome

Ordem de prioridade para cada pessoa marcada:

1. **Contato do sistema** (`Contacts`, mesma empresa), buscado pelo número ou pelo
   LID, se o nome não for o próprio número.
2. **Contatos enviados pelo WhatsApp** (tabela nova `WhatsappContacts`, abaixo):
   nome da agenda do celular (`name`), depois `verifiedName`, depois o nome do
   perfil (`notify`).
3. **Telefone formatado** (`+55 11 99999-9999`), quando o número é conhecido. Isso
   vale mesmo se a marcação veio pelo LID e o vínculo LID → telefone existe em
   `Contacts.lid` ou em `WhatsappContacts`.
4. **Os dígitos originais**, como aparece hoje.

## Mudanças no backend (`whatsapp-api`)

### 1. Marcações no recebimento

- `src/channels/baileys/parse.ts`: nova função `getMentionedJids(msg)`, que lê
  `contextInfo.mentionedJid` com a mesma busca usada em `getQuotedMessageId`
  (`extractMessageContent` + primeira chave).
- `src/channels/inbound.ts`: `InboundMessage` ganha `mentions: string[]` (vazia
  quando não há marcação). `normalizedForWebhook` passa a incluir `mentions`, e o
  payload bruto do Baileys continua igual para o n8n.
- `src/channels/baileys/toInbound.ts` preenche o campo. A regra de negócio não
  importa Baileys.

### 2. Tabela `WhatsappContacts` (conserta a lista de contatos do WhatsApp)

O serviço atual `CreateOrUpdateBaileysService` falha sempre: lê
`baileysExists.chats` antes de testar se o registro existe, e o erro é engolido.
Por isso a tabela `Baileys` está vazia, e a "Importação de contatos"
(`ImportContactsService`) também não funciona.

- Migration nova cria `WhatsappContacts`: `id`, `whatsappId` (FK para
  `Whatsapps`, `ON DELETE CASCADE`), `companyId`, `jid`, `lid`, `number` (só
  dígitos do telefone, quando conhecido), `name`, `notify`, `verifiedName`,
  `createdAt` e `updatedAt`. Índices: único em `(whatsappId, jid)`, simples em
  `(companyId, number)` e em `(companyId, lid)`.
- Serviço novo `UpsertWhatsappContactsService` recebe a lista de contatos do
  Baileys e faz upsert em lote. Ignora grupos, broadcast e `status@broadcast`, e
  não apaga campos já preenchidos com valor vazio (um `contacts.update` só com
  `notify` não pode apagar o `name`).
- Ele é chamado pelos eventos `contacts.upsert`, `contacts.update` e pelos
  `contacts` de `messaging-history.set`, no canal do Baileys (`wbotMonitor.ts` /
  listener). A chamada antiga para `createOrUpdateBaileysService` com contatos sai.
- `ImportContactsService` passa a ler de `WhatsappContacts`, e não do JSON da
  tabela `Baileys`. Na mesma mudança saem as gravações de `contatos_antes.txt` e
  `contatos_depois.txt` em `public/`, que são arquivos de depuração com dados
  pessoais.
- A tabela `Baileys` continua existindo (a coluna `chats` ainda é usada), mas
  não recebe mais contatos. Os dados antigos, se houver, ficam onde estão.
- Os registros não aparecem na tela de Contatos e não entram em campanhas.

### 3. Nome do contato que ficou igual ao número

`CreateOrUpdateContactService`: quando o contato já existe e o nome atual é
igual ao número (ou vazio), e a mensagem traz um nome (`pushName`), o nome é
atualizado. Nomes editados à mão nunca são sobrescritos.

### 4. Nomes das marcações na listagem

- Serviço novo `ResolveMentionsService(messages, companyId)`:
  - Para cada mensagem, pega as marcações de `dataJson` (o mesmo `getMentionedJids`,
    sem depender do socket). Isso vale também para mensagens antigas e para as
    enviadas pelo celular.
  - Junta os números e LIDs de toda a página e faz, no máximo, uma consulta em
    `Contacts` e uma em `WhatsappContacts`.
  - Devolve, por mensagem, `mentions: [{ token, name, phone }]`. `token` são os
    dígitos como aparecem no texto, `name` é o nome resolvido ou `null`, e
    `phone` é o telefone em dígitos ou `null`.
- `ListMessagesService` chama o serviço e acrescenta `mentions` a cada mensagem
  devolvida.
- As mensagens novas também passam pelo serviço antes do envio pelo socket
  (`appMessage`), para que apareçam com os nomes sem recarregar o ticket.
- Nada muda no banco em `Messages`: `body` continua com o texto original.

## Mudanças no frontend (`whatsapp-app`)

- `MarkdownWrapper` recebe `mentions` (opcional). Antes do markdown, cada
  `@<token>` do texto que estiver na lista vira um trecho destacado (cor de link,
  negrito leve):
  - com `name`: `@Maria`;
  - sem nome e com `phone`: `@+55 11 99999-9999`;
  - sem os dois: `@<token>`, como hoje.

  O `title` do trecho mostra o telefone quando ele é conhecido.
- `MessagesList` passa `message.mentions` para o `MarkdownWrapper` nas mensagens
  recebidas e enviadas. Um `@<dígitos>` sem entrada em `mentions` (texto digitado
  que não é marcação de verdade) não muda.

## Erros e casos-limite

- Se `dataJson` estiver ausente ou inválido, a mensagem fica sem marcações e a
  listagem segue normalmente.
- Se o serviço de nomes falhar, o erro vai para o log e a listagem sai sem
  `mentions`. O ticket nunca deixa de abrir por causa disso.
- A pessoa marcada pode ser o próprio número conectado. Nesse caso o nome vem da
  conexão (`Whatsapps.name`) quando não houver contato.
- Mensagens editadas usam as marcações da versão mais recente salva em `dataJson`.

## Testes

- Unitários (Jest):
  - `getMentionedJids` com texto, legenda de mídia, sem marcação e com o LID;
  - `UpsertWhatsappContactsService` ignora grupos e não apaga `name` com um
    update só de `notify`;
  - `ResolveMentionsService` com contato por número, contato por LID, contato
    com nome igual ao número (cai para `WhatsappContacts`), só telefone e nada
    conhecido;
  - regra do nome em `CreateOrUpdateContactService`.
- Em HM, com um grupo real:
  - marcação recebida mostra o nome;
  - mensagem antiga com marcação também mostra;
  - uma marcação digitada sem ser marcação não muda.
- **Medição:** depois de reiniciar o backend em HM, contar quantos registros de
  `WhatsappContacts` têm `name`, `verifiedName` ou `notify`. Esse número diz se a
  tabela ajuda de fato. Se quase não houver nomes, a tabela fica (conserta a
  importação de contatos), mas a expectativa sobre os nomes muda.

## Deploy

Uma migration nova (`WhatsappContacts`), que o Dockerfile de produção roda ao
subir. Nenhum seed novo. Publicar nos dois repositórios (api e app) só depois do
teste em HM, com confirmação antes do push na `main`.
