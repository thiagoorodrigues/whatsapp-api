import axios, { AxiosRequestConfig } from "axios";
import AppError from "../../errors/AppError";
import { gatewayConfig } from "../../config/whatsappEngine";

// Cliente HTTP do gateway whatsmeow (Go). Um método por rota; os nomes de
// campo seguem o JSON do gateway (README do weconex-api-meow).

export interface Address {
  jid?: string;
  number?: string;
  lid?: string;
  isGroup?: boolean;
}

export interface Content {
  type: "text" | "image" | "video" | "audio" | "document";
  text?: string;
  mentions?: string[];
  caption?: string;
  fileName?: string;
  mimetype?: string;
  voice?: boolean;
  // Relativo à pasta de mídia compartilhada (GATEWAY_MEDIA_ROOT).
  path?: string;
}

export interface Quoted {
  id: string;
  chat?: string;
  sender?: string;
  fromMe?: boolean;
  text?: string;
}

export interface SendRequest {
  to: Address;
  content: Content;
  quoted?: Quoted;
  forwarded?: boolean;
}

export interface SendResult {
  externalId: string;
  chatJid: string;
  raw: unknown;
}

// Alvo de apagar/reagir: fromMe aponta mensagem nossa; senão vale sender
// (obrigatório em grupo).
export interface MessageTarget {
  chat: string;
  sender?: string;
  fromMe?: boolean;
}

export interface Status {
  state: "connecting" | "qr" | "connected" | "logged_out" | "disconnected";
  me?: string;
}

export interface Health {
  status: string;
  connected: number;
  sessions: number;
}

export interface NumberCheck {
  number: string;
  exists: boolean;
  jid?: string;
}

export interface Participant {
  jid: string;
  lid?: string;
  phone?: string;
  isAdmin: boolean;
  isMe: boolean;
}

export interface GroupInfo {
  subject: string;
  description: string;
  createdAt: string | null;
  participants: Participant[];
}

export interface Downloaded {
  path: string;
  mimetype: string;
  fileName: string;
}

export type PresenceState = "available" | "unavailable";
export type TypingState = "composing" | "recording" | "paused";

const SHORT_TIMEOUT = 30 * 1000;
const LONG_TIMEOUT = 120 * 1000;

interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

// Traduz a falha do axios em AppError (códigos que o frontend já traduz).
const mapError = (err: unknown): never => {
  if (!axios.isAxiosError(err)) throw err;
  const res = err.response;
  if (!res) {
    // Sem resposta: rede caída, recusada, DNS ou timeout.
    throw new AppError("ERR_GATEWAY_UNAVAILABLE", 503);
  }
  const msg = (res.data as Envelope<unknown> | undefined)?.error || "";
  if (
    (res.status === 404 && msg === "session_not_found") ||
    (res.status === 409 && msg === "not_connected")
  ) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }
  if (res.status === 400) throw new AppError(msg || "ERR_GATEWAY_ERROR", 400);
  if (res.status === 401) throw new AppError("ERR_GATEWAY_UNAUTHORIZED", 502);
  throw new AppError("ERR_GATEWAY_ERROR", 502);
};

const seg = (v: string): string => encodeURIComponent(v);

export const gatewayClient = () => {
  const { url, token } = gatewayConfig();
  if (!url) {
    throw new Error(
      "GATEWAY_URL não configurada: o cliente do gateway só vale com WHATSAPP_ENGINE=whatsmeow"
    );
  }

  const call = async <T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { data?: unknown; params?: Record<string, string>; long?: boolean; auth?: boolean } = {}
  ): Promise<T> => {
    const config: AxiosRequestConfig = {
      method,
      url: `${url}${path}`,
      timeout: opts.long ? LONG_TIMEOUT : SHORT_TIMEOUT,
      headers: opts.auth === false ? {} : { Authorization: `Bearer ${token}` }
    };
    if (opts.data !== undefined) config.data = opts.data;
    if (opts.params) config.params = opts.params;
    try {
      const res = await axios.request<Envelope<T>>(config);
      return res.data.data;
    } catch (err) {
      return mapError(err);
    }
  };

  const s = (id: number) => `/sessions/${id}`;

  return {
    health: () => call<Health>("GET", "/health", { auth: false }),
    connect: (id: number) => call<Status>("POST", `${s(id)}/connect`),
    disconnect: (id: number) => call<{}>("POST", `${s(id)}/disconnect`),
    logout: (id: number) => call<{}>("POST", `${s(id)}/logout`),
    status: (id: number) => call<Status>("GET", s(id)),
    pairPhone: (id: number, phone: string) =>
      call<{ code: string }>("POST", `${s(id)}/pair-phone`, { data: { phone } }),

    sendMessage: (id: number, req: SendRequest) =>
      call<SendResult>("POST", `${s(id)}/messages`, { data: req, long: true }),
    revokeMessage: (id: number, msgId: string, target: MessageTarget) =>
      call<{}>("DELETE", `${s(id)}/messages/${seg(msgId)}`, { data: target }),
    editMessage: (id: number, msgId: string, chat: string, text: string) =>
      call<{}>("PUT", `${s(id)}/messages/${seg(msgId)}`, { data: { chat, text } }),
    // emoji vazio remove a reação.
    reactToMessage: (
      id: number,
      msgId: string,
      body: MessageTarget & { emoji: string }
    ) =>
      call<{}>("POST", `${s(id)}/messages/${seg(msgId)}/reaction`, { data: body }),

    markRead: (id: number, chat: string, ids: string[], sender?: string) =>
      call<{}>("POST", `${s(id)}/read`, {
        data: sender ? { chat, ids, sender } : { chat, ids }
      }),
    setPresence: (id: number, presence: PresenceState) =>
      call<{}>("POST", `${s(id)}/presence`, { data: { presence } }),
    typing: (id: number, chat: string, state: TypingState) =>
      call<{}>("POST", `${s(id)}/typing`, { data: { chat, state } }),
    subscribePresence: (id: number, chat: string) =>
      call<{}>("POST", `${s(id)}/presence/subscribe`, { data: { chat } }),

    checkNumbers: (id: number, numbers: string[]) =>
      call<NumberCheck[]>("POST", `${s(id)}/check`, { data: { numbers } }),
    // "" quando não há foto ou ela está oculta.
    avatar: async (id: number, jid: string): Promise<string> => {
      const r = await call<{ url: string }>("GET", `${s(id)}/avatar`, {
        params: { jid }
      });
      return r.url;
    },
    groupInfo: (id: number, jid: string) =>
      call<GroupInfo>("GET", `${s(id)}/groups/${seg(jid)}`),
    rejectCall: (id: number, callId: string, from: string) =>
      call<{}>("POST", `${s(id)}/calls/${seg(callId)}/reject`, { data: { from } }),

    // raw = `raw.message` do evento; null quando o WhatsApp já não tem o arquivo.
    downloadMedia: (id: number, rawMessage: unknown) =>
      call<Downloaded | null>("POST", `${s(id)}/media`, {
        data: { message: rawMessage },
        long: true
      })
  };
};

export type GatewayClient = ReturnType<typeof gatewayClient>;
