# Integrações de parceiros (Plamev) — design

Data: 2026-10-10

## Objetivo

Permitir que a empresa conecte integrações de parceiros, a começar pela
**Plamev**, colando um token em Configurações. Na conversa, um botão no
cabeçalho do ticket abre um menu com as ferramentas daquela integração: para a
Plamev, **Rede credenciada** e **Planos**. O acesso a cada integração é
liberado **no plano**.

Esta entrega monta a base: liberação no plano, conexão do token e o botão com
submenu. As ferramentas em si ficam para a próxima rodada; nesta fase cada item
abre um modal "Em breve".

Sucesso:
- O super libera "Plamev" no plano da empresa.
- O admin da empresa cola o token, que é testado contra a API da Plamev antes
  de ser salvo.
- A partir daí, o botão aparece na conversa para todos os atendentes da
  empresa, com o submenu Plamev → Rede credenciada / Planos.

## Decisões

- **Liberação por integração**: cada plano tem a lista de integrações que
  libera. Uma integração nova entra no catálogo sem precisar de migration no
  plano.
- **Catálogo fixo no código**: as integrações são feitas por nós; o cliente não
  monta integrações sozinho.
- **Um token por empresa.** O token da Plamev é do vendedor, e a venda fica
  atribuída ao dono do token. Para consultar rede e planos isso não importa.
  Quando vierem cotação e venda, entra um token por usuário, que substitui o da
  empresa quando estiver preenchido.
- **Seção própria**: Configurações → Integrações. Não reaproveita a página de
  integrações das filas (webhook, typebot, dialogflow), que é outro conceito.
- Empresa sem a integração no plano **não vê o card**: a seção aparece só com o
  que está liberado e some do menu quando não há nenhuma.
- **URL da API da Plamev é do servidor** (`PLAMEV_API_URL` no `.env`), e não um
  campo que o cliente preenche. Homologação e produção da Plamev são hosts
  diferentes.

## Fora do escopo

- As ferramentas Rede credenciada e Planos: telas, chamadas e envio ao cliente.
- Token por usuário e venda ou cotação atribuída ao atendente.
- Uso das integrações pelo agente de IA.
- Vitrine de integrações bloqueadas para upsell.

## Dados

### `Plans.integrations`

JSONB, `NOT NULL`, padrão `[]`, com as chaves do catálogo, por exemplo
`["plamev"]`.

Entra em:
- o model `Plan`;
- `PlanController` e os services de criar e editar plano;
- `ShowPlanCompanyService` e `ListCompaniesPlanService`.

Ao salvar, chaves fora do catálogo são descartadas.

### `CompanyIntegrations`

| Coluna | Tipo | Observação |
|---|---|---|
| id | serial | |
| companyId | int FK Companies, cascade | |
| provider | string | chave do catálogo (`"plamev"`) |
| tokenEncrypted | text | `encryptSecret` do `helpers/secretBox` |
| tokenHint | string | `secretHint`, por exemplo `••••a1b2` |
| status | string | `connected` ou `error` |
| lastCheckedAt | date | último teste |
| lastError | string, nulo | mensagem do último teste com falha |
| createdAt, updatedAt | | |

Tem índice único em (`companyId`, `provider`). Um `@DefaultScope` exclui
`tokenEncrypted`, como já acontece no `QueueIntegrations`. O token nunca volta
para o front.

## Backend

### Catálogo

Fica em `src/services/IntegrationServices/providers/`:

```ts
interface IntegrationProvider {
  key: string;                 // "plamev"
  name: string;                // "Plamev"
  description: string;
  tools: { key: string; label: string }[];
  testConnection(token: string): Promise<void>; // lança IntegrationError
}
```

`providers/index.ts` exporta o registro e a função `getProvider(key)`.

### Plamev

`providers/plamev/` contém:
- `client.ts`: cliente HTTP adaptado do `plamev-mcp/src/plamev-client.ts`. Faz
  timeout de 15 s, manda o header `Authorization` com o token literal e
  converte 401/403 em erro de autenticação e 400 em erro de validação.
- `index.ts`: o provider. As ferramentas são `rede` ("Rede credenciada") e
  `planos` ("Planos").

`testConnection` faz `GET Estados/consultar`. Uma resposta 401/403 significa
token recusado; um timeout ou erro de rede significa Plamev indisponível.
Durante a implementação é preciso confirmar com um token inválido que esse
endpoint exige autenticação. Se não exigir, troca-se por outra leitura
autenticada do Swagger.

`PLAMEV_API_URL` vai para o `.env.example`. Se a variável estiver vazia, a
Plamev não aparece no catálogo.

### Checagem de plano

`helpers/integrationAccess.ts` expõe:
- `companyIntegrations(companyId)`, que devolve as chaves do plano da empresa;
- `assertIntegration(companyId, key)`, que lança
  `ERR_INTEGRATION_NOT_AVAILABLE` com status 403.

### Rotas (`routes/integrationRoutes.ts`)

| Rota | Quem | O que faz |
|---|---|---|
| `GET /integrations/catalog` | `isSuper` | catálogo completo (`key`, `name`), usado no formulário de plano |
| `GET /integrations` | `isAuth` | integrações do plano da empresa, cada uma com `name`, `description`, `tools`, `connected`, `status`, `tokenHint`, `lastCheckedAt` e `lastError` |
| `PUT /integrations/:provider` | `isAdmin` | recebe `{ token }`, testa e só salva se passar; devolve o item atualizado |
| `POST /integrations/:provider/test` | `isAdmin` | testa o token salvo e atualiza `status`, `lastCheckedAt` e `lastError` |
| `DELETE /integrations/:provider` | `isAdmin` | apaga a linha (desconecta) |

Comportamento:
- Todas as rotas com `:provider` checam o catálogo (404 se a chave não existir)
  e o plano (403).
- Se a integração sair do plano, a linha em `CompanyIntegrations` continua
  guardada. O `GET` só não a lista mais. Se ela voltar ao plano, o token já
  está lá.
- No `PUT`, se o teste falhar, nada é gravado e a resposta é 400 com a
  mensagem.
- No teste do token salvo, uma falha grava `status=error` e `lastError`.

## Frontend

### Planos

Em `components/PlansManager`, logo abaixo dos recursos, entra o bloco
**"Integrações de parceiros"** com um checkbox por item de
`GET /integrations/catalog`. O valor vai em `integrations` no salvar.

### Configurações → Integrações

A rota é `/settings/integracoes`. Ela entra no `SECTIONS` do
`pages/SettingsCustom` e no submenu de Configurações do `MainListItems`, para
admins, e só se `plan.integrations` não estiver vazio.

O componente `components/Settings/Integrations.js` mostra um card por item de
`GET /integrations`:
- logo, que fica em `public/integrations/plamev.svg`, nome e descrição;
- chip de status: **Conectado**, **Erro** com a mensagem, ou **Não conectado**;
- `PasswordField` para o token, com placeholder igual à `tokenHint` quando já
  está conectado;
- botões **Salvar e testar**, **Testar conexão** e **Desconectar** (com
  confirmação).

As mensagens de sucesso e de erro saem pelo `toastError` e pelo toast de
sucesso padrão.

### Botão na conversa

O componente novo `components/TicketIntegrationsMenu` entra em
`TicketActionButtonsCustom`, antes do botão de adicionar participante.

Comportamento:
- Lê `GET /integrations` e mantém em cache no contexto enquanto a página está
  aberta.
- Só aparece se houver pelo menos uma integração `connected`.
- O ícone é `Extension`, com a dica "Integrações".
- O menu tem um item por integração conectada (**Plamev ›**). Cada um abre um
  submenu com as `tools` (**Rede credenciada**, **Planos**).
- Clicar numa ferramenta abre `IntegrationToolModal`, com o título
  "Plamev — Rede credenciada" e o corpo "Em breve". O modal recebe
  `{ provider, tool, ticket }`, para a próxima rodada encaixar a ferramenta
  sem mexer no menu.

## Erros

| Situação | Resposta e mensagem |
|---|---|
| Token recusado (401/403 da Plamev) | 400 "A Plamev recusou o token. Confira se ele foi copiado inteiro." |
| Plamev sem resposta | 502 "A Plamev não respondeu agora. Tente de novo em instantes." |
| Integração fora do plano | 403 `ERR_INTEGRATION_NOT_AVAILABLE` "Esta integração não está disponível no seu plano." |
| `PLAMEV_API_URL` ausente | integração some do catálogo; nenhuma rota aceita `plamev` |

Falhas inesperadas vão para os Logs do sistema com protocolo, pelo
`errorHandler` atual. O token nunca aparece em log nem em mensagem.

## Testes

Testes unitários (Jest) cobrem:
- `plamev/client`: repassa o header; 401 vira erro de autenticação; timeout
  vira indisponível.
- `integrationAccess`: com e sem a chave no plano.
- O fluxo do `PUT`: com o teste ok, salva criptografado; com o teste falhando,
  não salva; o `GET` nunca devolve o token.

Homologação (HM):
1. Liberar Plamev no plano da Wazzy Demo e colar o token de homologação, que o
   usuário cola na tela.
2. Testar a conexão.
3. Abrir uma conversa e conferir o botão e o submenu.
4. Tirar a integração do plano e conferir que o botão e o card somem.
5. Colocar de volta e conferir que continua conectado.

## Publicação

O deploy segue o fluxo de sempre: main, build, migrate e restart. Antes de
publicar em produção, acrescentar `PLAMEV_API_URL` (URL de produção da Plamev,
a confirmar com o usuário) no EasyPanel.
