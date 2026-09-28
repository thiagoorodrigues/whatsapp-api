# Marcar participantes ao escrever (parte 2)

Data: 2026-09-28 · Repositórios: `whatsapp-api` e `whatsapp-app`
Depende da parte 1 (`2026-09-28-group-mentions-display-design.md`), já em produção.

## Objetivo

Num ticket de grupo, quem atende digita `@`, vê os participantes do grupo com o
nome, escolhe um, e a mensagem sai como marcação de verdade no WhatsApp: a
pessoa aparece destacada e é notificada. No ticket, a mensagem enviada aparece
com `@Nome`, e essa parte a 1 já resolve.

Fora do escopo: marcação em legenda de mídia, "marcar todos" e marcação em
conversas individuais.

## Como o WhatsApp recebe uma marcação

O texto contém `@<dígitos>` (o LID ou o telefone do participante, os mesmos
dígitos do JID) e o envio leva a lista `mentions: [jid, ...]`. O app do WhatsApp
de cada pessoa troca `@<dígitos>` pelo nome.

## Escrevendo (app)

- Ao escolher um participante, entra `@Maria ` no texto (com espaço depois), no
  lugar do `@ma` digitado. O app guarda a lista de marcações escolhidas
  (`@Maria` → JID e dígitos).
- A lista abre quando, antes do cursor, há `@` no começo do texto ou depois de
  espaço/quebra de linha, seguido de zero ou mais caracteres sem espaço. Ela
  filtra pelo nome (sem diferenciar maiúsculas nem acentos), pelo telefone e
  pelos dígitos. Mostra até 8 itens: o nome e, ao lado, o telefone formatado
  quando conhecido. Quem não tem nome aparece pelo telefone ou pelos dígitos.
- Teclado: ↑/↓ navegam, Enter ou Tab escolhem, Esc fecha. Com a lista aberta, o
  Enter escolhe e não envia.
- Dois participantes com o mesmo nome recebem rótulos distintos, com os 4
  últimos dígitos do telefone ou do LID: `@Maria (7761)`.
- No envio, cada rótulo escolhido que ainda está no texto vira `@<dígitos>` e o
  JID entra em `mentions`. Um rótulo apagado do texto não vai. A assinatura
  (`*Nome:*`) continua sendo acrescentada depois.
- Os participantes são buscados no primeiro `@` do ticket e ficam guardados
  enquanto o ticket estiver aberto na tela.
- As respostas rápidas com `/` continuam como estão.
- Só em tickets de grupo. Em conversa individual, o `@` é texto comum.

## Backend (`whatsapp-api`)

### Canal

- `MessagingChannel.groupParticipants(chat: ChatAddress): Promise<GroupParticipant[]>`,
  com `GroupParticipant = { jid, lid?, phone?, isAdmin, isMe }`. `jid` é o id
  que o grupo usa para o participante (LID ou telefone) e `phone` são os
  dígitos do telefone quando conhecidos.
- `BaileysChannel`: usa `getGroupMetadata` (cache de 10 min que já existe) e o
  `groupJid` que já existe. `isMe` compara com `socket.user.id`/`user.lid`.
- O conteúdo de texto ganha `mentions?: string[]`, e `toBaileysContent` envia
  `{ text, mentions }` quando a lista não está vazia.

### Nomes

- A resolução de nomes da parte 1 é extraída do `ResolveMentionsService` para
  uma função exportada, `resolveMentionNames(jids, companyId): Promise<Map<jid, MentionView>>`.
  O serviço passa a usá-la, sem mudar o que devolve.

### Rota de participantes

- `GET /tickets/:ticketId/participants` (autenticada, empresa do usuário):
  - responde 400 `ERR_TICKET_NOT_GROUP` quando o ticket não é de grupo;
  - para cada participante que não é o próprio número, resolve os nomes do
    `jid` e também do JID de telefone, quando `phone` é conhecido. O nome vem
    do primeiro que tiver, e o telefone vem de `phone` ou da resolução;
  - devolve `[{ jid, token, name, phone, isAdmin }]`, ordenado por nome, com
    quem não tem nome no fim;
  - se o WhatsApp estiver desconectado, o erro sai como hoje (o app mostra a
    mensagem de erro e a lista não abre).

### Envio

- `POST /messages/:ticketId` aceita `mentions?: string[]`.
- `SendWhatsAppMessage` recebe `mentions`. Se o ticket é de grupo e há
  marcações, mantém só os JIDs que são participantes do grupo e ignora o resto
  sem erro. Em ticket individual, ignora `mentions`.
- A mensagem salva (`dataJson` do envio) já traz `contextInfo.mentionedJid`,
  então a parte 1 mostra `@Nome` no ticket e na prévia sem mudança.

## Erros e casos-limite

- A busca de participantes falhou: o app não abre a lista e o `@` continua como
  texto. Tenta de novo no próximo `@`.
- O participante saiu do grupo entre a escolha e o envio: a marcação é
  descartada no backend e o texto sai com os dígitos.
- A mensagem editada no app depois de escolher (rótulo alterado, por exemplo
  `@Mari`): o rótulo não bate, a marcação não vai, e o texto sai como digitado.

## Testes

- Backend (Jest):
  - `toBaileysContent` com e sem `mentions`;
  - `BaileysChannel.groupParticipants` (LID com telefone, telefone, admin, eu);
  - `resolveMentionNames` coberto pelos testes existentes do resolver;
  - o serviço de participantes: 400 fora de grupo, sem o próprio número, nome
    pelo telefone quando o LID não tem, e a ordem;
  - o filtro de `mentions` no `SendWhatsAppMessage`.
- App (Jest do CRA):
  - `findMentionQuery` (começo, depois de espaço, sem gatilho em e-mail, cursor
    no meio);
  - `insertMention`;
  - `filterParticipants` (acentos, telefone, limite de 8);
  - `mentionLabels` (nomes repetidos);
  - `buildMentionPayload` (troca, rótulo apagado, várias marcações).
- HM: num grupo real, marcar uma pessoa e conferir no celular que ela aparece
  marcada e que o ticket mostra `@Nome`.

## Deploy

Sem migration. Publicar api e app juntos, depois do teste em HM e com
confirmação do usuário antes do push na `main`.
