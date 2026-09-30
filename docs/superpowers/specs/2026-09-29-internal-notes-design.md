# Nota interna na conversa

Data: 2026-09-29 · Repositórios: `whatsapp-api` e `whatsapp-app`

## Objetivo

Quem atende escreve, dentro da conversa do ticket, uma nota que o cliente não
vê. A nota aparece no meio das mensagens, na ordem em que foi escrita, com
estilo próprio e o nome do autor, e chega na hora para os outros atendentes que
estiverem com o ticket aberto.

Fora do escopo: anexos e áudio na nota, marcar atendente com `@`, editar ou
apagar nota. As notas antigas do painel lateral do contato (`TicketNote`)
continuam como estão, sem migração.

## Dados

Migration `20260929110000-add-internal-note-to-messages.ts` em `Messages`:

- `isPrivate` BOOLEAN, `allowNull: false`, `defaultValue: false`.
- `userId` INTEGER, nulo, FK para `Users` (`onDelete: SET NULL`). Guarda o autor
  da nota. Mensagens comuns continuam com `userId` nulo.

No model `Message`: `isPrivate: boolean`, `userId` com `@ForeignKey(() => User)`
e `@BelongsTo(() => User) user`.

## Backend

**Envio.** `MessageController.store` lê `isPrivate` do corpo. Quando é `true`:

- recusa se vierem mídias (`ERR_INTERNAL_NOTE_MEDIA`, 400) ou corpo vazio
  (`ERR_INTERNAL_NOTE_EMPTY`, 400);
- chama `CreateInternalNoteService({ ticket, body, userId: req.user.id })` e
  retorna, sem `SetTicketMessagesAsRead` e sem tocar no WhatsApp.

`CreateInternalNoteService` chama `CreateMessageService` com `id: uuid()`, sem
`messagesWhatsappsId`, `fromMe: true`, `read: true`, `ack: 0`,
`mediaType: "internalNote"`, `isPrivate: true`, `userId`, `ticketId`,
`contactId` e `companyId` do ticket.

**`CreateMessageService`.** Aceita `isPrivate` e `userId`. Quando `isPrivate`:
não atualiza `ticket.lastMessage` e inclui `user` (id, name) no `findByPk`.
O emit `company-${companyId}-appMessage` com `action: "create"` continua igual.
Assim quem está com o ticket aberto recebe a nota, a prévia não muda, e o
`NotificationsPopOver` não dispara porque só reage a `!fromMe`.

**Listagem.** `ListMessagesService` inclui `user` (id, name) para as notas
aparecerem com o autor ao recarregar.

**Excluir notas de onde elas não pertencem** (`isPrivate: false` no where):

- `RunAiAgentService` (histórico do agente), para a nota não virar fala do
  assistente;
- `ProcessInboundMessage`: checagem da mensagem de encerramento e da saudação;
- `BackfillMentionPreviewsService` (recalcula `lastMessage`).

**Recusar ações que iriam ao WhatsApp** com `ERR_INTERNAL_NOTE_ACTION` (400)
quando a mensagem é nota: encaminhar (`ForwardMessageService`) e apagar
(`DeleteWhatsAppMessage`). Editar não precisa de guarda: `UpdateMessageService`
só trata edições vindas do WhatsApp, por `messagesWhatsappsId`, que a nota não tem. Citar uma nota
já cai fora sozinho em `SendWhatsAppMessage` porque ela não tem
`messagesWhatsappsId`, mas o frontend também esconde "Responder".

A busca de tickets por texto continua achando conteúdo de notas; é útil para a
equipe e o texto não sai do sistema.

Relatórios não contam `Messages`, então não mudam.

## Frontend

**`MessageInputCustom`.**

- O menu `+` ganha o item "Nota interna" (ícone de cadeado).
- Com o modo ativo, o campo fica com fundo amarelo claro, o texto de ajuda muda
  para "Nota interna — o cliente não verá", e aparece um chip "Nota interna" com
  um "x" para sair. Microfone e assinatura ficam desligados e o `+` some,
  porque a nota é só texto.
- Enviar faz `api.post(`/messages/${ticketId}`, { body, isPrivate: true })`, sem
  assinatura e sem `quotedMsg`, e desliga o modo. `Esc` também sai do modo.
- Trocar de ticket desliga o modo.

**`MessagesList`.**

- Em `renderMessages`, antes do ramo `fromMe`, um ramo para
  `message.isPrivate`: balão à direita, fundo e borda à esquerda com os tokens
  `warningSoft` / `warningText` do tema (já têm versão clara e escura), cabeçalho
  "🔒 Nota interna · {user.name}", corpo em `MarkdownWrapper`, horário, sem ack.
- `renderMessageDivider` trata a nota como `fromMe` (não quebra o agrupamento).
- `MessageOptionsMenu`: numa nota só aparece "Copiar".

## Erros

- Falha ao gravar a nota: toast com o erro, e o texto continua no campo.
- Os códigos novos (`ERR_INTERNAL_NOTE_EMPTY`, `ERR_INTERNAL_NOTE_MEDIA`,
  `ERR_INTERNAL_NOTE_ACTION`)
  ganham tradução em `translations`.

## Testes

- `CreateInternalNoteService`: não chama o canal do WhatsApp, grava
  `isPrivate: true` com `userId`, e não altera `ticket.lastMessage`.
- `RunAiAgentService`: nota não entra no histórico.
- Homologação (Docker local): enviar nota num ticket, ver em outra aba logada
  com outro usuário, recarregar e continuar vendo com o autor, confirmar que
  nada chegou no celular do contato e que a prévia na lista não mudou.
