/**
 * OpenAPI 3 document for the external messaging API (routes protected by
 * tokenAuth in routes/messageRoutes.ts). Served by routes/docsRoutes.ts at
 * /api-docs (Swagger UI) and /api-docs.json.
 *
 * Keep it in sync with messageRoutes.ts; docs/__tests__/openapi.spec.ts
 * fails when a token-protected route is added or removed without updating
 * this file.
 */

const number = {
  type: "string",
  description:
    "Número de destino com DDI e DDD, só dígitos. Para grupos, o id do grupo.",
  example: "5531999999999"
};

const body = {
  type: "string",
  description:
    "Texto da mensagem. Aceita as variáveis do sistema, como {{name}} para o nome do contato.",
  example: "Olá {{name}}, seu pedido foi enviado!"
};

const errorResponse = (description: string, example: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
      example: { error: example }
    }
  }
});

const commonResponses = {
  "200": {
    description: "Mensagem aceita para envio.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Success" }
      }
    }
  },
  "400": errorResponse(
    "Requisição inválida ou falha no envio (número ausente, conexão desconectada etc.).",
    "O número é obrigatório"
  ),
  "401": errorResponse(
    "Token ausente ou não pertence a nenhuma conexão.",
    "Acesso não permitido"
  )
};

const security = [{ connectionToken: [] }];

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "SwEasy OmniChannel – API de mensagens",
    version: "1.0.0",
    description: [
      "API para enviar mensagens de WhatsApp a partir de outros sistemas.",
      "",
      "**Autenticação:** cada conexão de WhatsApp tem um token próprio, definido em",
      "*Conexões → editar conexão → Token*. Envie no cabeçalho",
      "`Authorization: Bearer <token>`. A mensagem sai pela conexão dona do token.",
      "",
      "Use o botão **Authorize** para informar o token e testar os endpoints aqui mesmo."
    ].join("\n")
  },
  servers: [{ url: "/", description: "Este servidor" }],
  tags: [{ name: "Mensagens", description: "Envio de mensagens pela conexão do token" }],
  components: {
    securitySchemes: {
      connectionToken: {
        type: "http",
        scheme: "bearer",
        description: "Token da conexão de WhatsApp (Conexões → Token)."
      }
    },
    schemas: {
      Success: {
        type: "object",
        properties: { mensagem: { type: "string", example: "Mensagem enviada" } }
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } }
      },
      TextMessage: {
        type: "object",
        required: ["number"],
        properties: { number, body }
      }
    }
  },
  paths: {
    "/api/messages/send": {
      post: {
        tags: ["Mensagens"],
        summary: "Enviar mensagem, com ou sem arquivos",
        description: [
          "Coloca a mensagem na fila de envio. A conexão precisa estar **conectada**.",
          "O contato é criado ou atualizado automaticamente.",
          "",
          "Para enviar arquivos use `multipart/form-data` e repita o campo `medias`",
          "para cada arquivo. O texto vai como legenda. Sem arquivos, envie JSON."
        ].join("\n"),
        security,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["number"],
                properties: {
                  number,
                  body,
                  medias: {
                    type: "array",
                    items: { type: "string", format: "binary" },
                    description: "Um ou mais arquivos (imagem, áudio, vídeo, documento)."
                  }
                }
              }
            },
            "application/json": {
              schema: { $ref: "#/components/schemas/TextMessage" }
            }
          }
        },
        responses: commonResponses
      }
    },
    "/api/messages/send-fila": {
      post: {
        tags: ["Mensagens"],
        summary: "Enviar mensagem de texto pela fila de envio",
        description:
          "Mesmo comportamento de `/api/messages/send`, só para texto. A conexão precisa estar **conectada**.",
        security,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TextMessage" }
            }
          }
        },
        responses: commonResponses
      }
    }
  }
};

export default openapi;
