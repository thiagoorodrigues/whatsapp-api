jest.mock("axios");
jest.mock("../../../config/whatsappEngine", () => ({
  gatewayConfig: jest.fn()
}));

/* eslint-disable import/first */
import axios from "axios";
import { gatewayConfig } from "../../../config/whatsappEngine";
import AppError from "../../../errors/AppError";
import { gatewayClient } from "../client";
/* eslint-enable import/first */

const request = axios.request as unknown as jest.Mock;
const isAxiosError = jest.fn();
(axios as any).isAxiosError = isAxiosError;

const ok = (data: any) => ({ data: { success: true, data, error: null } });
const httpError = (status: number, error: string) => ({
  isAxiosError: true,
  response: { status, data: { success: false, data: null, error } }
});
const netError = (code?: string) => ({ isAxiosError: true, code, message: "boom" });

const last = () => request.mock.calls[request.mock.calls.length - 1][0];

beforeEach(() => {
  request.mockReset();
  (gatewayConfig as jest.Mock).mockReturnValue({
    url: "http://gw:8080",
    token: "secret-token",
    mediaRoot: "/media"
  });
  isAxiosError.mockImplementation((e: any) => !!e && e.isAxiosError === true);
});

describe("gatewayClient: rotas", () => {
  it("usa Authorization Bearer e a URL base", async () => {
    request.mockResolvedValue(ok({ state: "connected" }));
    await gatewayClient().connect(3);
    expect(last().url).toBe("http://gw:8080/sessions/3/connect");
    expect(last().method).toBe("POST");
    expect(last().headers.Authorization).toBe("Bearer secret-token");
    expect(last().timeout).toBe(30000);
  });

  it("falha claro sem GATEWAY_URL", () => {
    (gatewayConfig as jest.Mock).mockReturnValue({ url: "", token: "", mediaRoot: "" });
    expect(() => gatewayClient()).toThrow(/GATEWAY_URL/);
  });

  it("health sem token", async () => {
    request.mockResolvedValue(ok({ status: "ok", connected: 1, sessions: 2 }));
    const r = await gatewayClient().health();
    expect(r.sessions).toBe(2);
    expect(last().url).toBe("http://gw:8080/health");
    expect(last().method).toBe("GET");
    expect(last().headers.Authorization).toBeUndefined();
  });

  it("disconnect, logout, status, pairPhone", async () => {
    const c = gatewayClient();
    request.mockResolvedValue(ok({}));
    await c.disconnect(3);
    expect([last().method, last().url]).toEqual(["POST", "http://gw:8080/sessions/3/disconnect"]);
    await c.logout(3);
    expect([last().method, last().url]).toEqual(["POST", "http://gw:8080/sessions/3/logout"]);
    request.mockResolvedValue(ok({ state: "qr" }));
    expect(await c.status(3)).toEqual({ state: "qr" });
    expect([last().method, last().url]).toEqual(["GET", "http://gw:8080/sessions/3"]);
    request.mockResolvedValue(ok({ code: "ABCD-1234" }));
    expect(await c.pairPhone(3, "5511999999999")).toEqual({ code: "ABCD-1234" });
    expect(last().data).toEqual({ phone: "5511999999999" });
  });

  it("send: corpo, timeout longo e resultado", async () => {
    const result = { externalId: "X", chatJid: "1@s.whatsapp.net", raw: {} };
    request.mockResolvedValue(ok(result));
    const body = {
      to: { number: "5511999999999" },
      content: { type: "audio" as const, path: ".gateway/out/a.ogg", mimetype: "audio/ogg", voice: false },
      quoted: { id: "Q1", chat: "c", fromMe: true }
    };
    expect(await gatewayClient().sendMessage(3, body)).toEqual(result);
    expect(last().url).toBe("http://gw:8080/sessions/3/messages");
    expect(last().method).toBe("POST");
    expect(last().data).toEqual(body);
    expect(last().timeout).toBe(120000);
  });

  it("revoke, edit, react", async () => {
    const c = gatewayClient();
    request.mockResolvedValue(ok({}));
    await c.revokeMessage(3, "M 1", { chat: "c", fromMe: true });
    expect([last().method, last().url, last().data]).toEqual([
      "DELETE", "http://gw:8080/sessions/3/messages/M%201", { chat: "c", fromMe: true }
    ]);
    await c.editMessage(3, "M1", "c", "novo");
    expect([last().method, last().url, last().data]).toEqual([
      "PUT", "http://gw:8080/sessions/3/messages/M1", { chat: "c", text: "novo" }
    ]);
    await c.reactToMessage(3, "M1", { chat: "g", sender: "s", emoji: "" });
    expect([last().method, last().url, last().data]).toEqual([
      "POST", "http://gw:8080/sessions/3/messages/M1/reaction", { chat: "g", sender: "s", emoji: "" }
    ]);
  });

  it("read, presence, typing, subscribe", async () => {
    const c = gatewayClient();
    request.mockResolvedValue(ok({}));
    await c.markRead(3, "g", ["A", "B"], "s");
    expect([last().url, last().data]).toEqual(["http://gw:8080/sessions/3/read", { chat: "g", ids: ["A", "B"], sender: "s" }]);
    await c.setPresence(3, "available");
    expect([last().url, last().data]).toEqual(["http://gw:8080/sessions/3/presence", { presence: "available" }]);
    await c.typing(3, "c", "composing");
    expect([last().url, last().data]).toEqual(["http://gw:8080/sessions/3/typing", { chat: "c", state: "composing" }]);
    await c.subscribePresence(3, "c");
    expect([last().url, last().data]).toEqual(["http://gw:8080/sessions/3/presence/subscribe", { chat: "c" }]);
  });

  it("check, avatar, group, rejectCall", async () => {
    const c = gatewayClient();
    request.mockResolvedValue(ok([{ number: "55", exists: true, jid: "55@s.whatsapp.net" }]));
    expect((await c.checkNumbers(3, ["55"]))[0].exists).toBe(true);
    expect(last().data).toEqual({ numbers: ["55"] });
    request.mockResolvedValue(ok({ url: "" }));
    expect(await c.avatar(3, "55@s.whatsapp.net")).toBe("");
    expect(last().method).toBe("GET");
    expect(last().url).toBe("http://gw:8080/sessions/3/avatar");
    expect(last().params).toEqual({ jid: "55@s.whatsapp.net" });
    request.mockResolvedValue(ok({ subject: "G", description: "", createdAt: null, participants: [] }));
    await c.groupInfo(3, "120363@g.us");
    expect(last().url).toBe("http://gw:8080/sessions/3/groups/120363%40g.us");
    request.mockResolvedValue(ok({}));
    await c.rejectCall(3, "CALL1", "55@s.whatsapp.net");
    expect([last().url, last().data]).toEqual(["http://gw:8080/sessions/3/calls/CALL1/reject", { from: "55@s.whatsapp.net" }]);
  });

  it("downloadMedia: corpo, timeout longo e null", async () => {
    request.mockResolvedValue(ok({ path: ".gateway/in/x.jpg", mimetype: "image/jpeg", fileName: "x.jpg" }));
    const raw = { imageMessage: {} };
    expect((await gatewayClient().downloadMedia(3, raw))?.path).toBe(".gateway/in/x.jpg");
    expect(last().data).toEqual({ message: raw });
    expect(last().timeout).toBe(120000);
    request.mockResolvedValue(ok(null));
    expect(await gatewayClient().downloadMedia(3, raw)).toBeNull();
  });
});

describe("gatewayClient: erros", () => {
  const code = async (err: unknown) => {
    request.mockRejectedValue(err);
    try {
      await gatewayClient().status(3);
    } catch (e) {
      return e as AppError;
    }
    throw new Error("não lançou");
  };

  it("404 session_not_found e 409 not_connected viram ERR_WAPP_NOT_INITIALIZED", async () => {
    for (const e of [httpError(404, "session_not_found"), httpError(409, "not_connected")]) {
      const err = await code(e);
      expect(err).toBeInstanceOf(AppError);
      expect(err.message).toBe("ERR_WAPP_NOT_INITIALIZED");
      expect(err.statusCode).toBe(400);
    }
  });

  it("400 leva a mensagem do gateway", async () => {
    const err = await code(httpError(400, "quoted.id obrigatório"));
    expect(err.message).toBe("quoted.id obrigatório");
    expect(err.statusCode).toBe(400);
  });

  it("401 e 500 viram erros genéricos do gateway", async () => {
    expect((await code(httpError(401, "unauthorized"))).message).toBe("ERR_GATEWAY_UNAUTHORIZED");
    const e500 = await code(httpError(500, "falha interna"));
    expect(e500.message).toBe("ERR_GATEWAY_ERROR");
    expect(e500.statusCode).toBe(502);
  });

  it("rede e timeout viram ERR_GATEWAY_UNAVAILABLE", async () => {
    for (const e of [netError("ECONNREFUSED"), netError("ECONNABORTED"), netError("ETIMEDOUT")]) {
      const err = await code(e);
      expect(err.message).toBe("ERR_GATEWAY_UNAVAILABLE");
      expect(err.statusCode).toBe(503);
    }
  });

  it("erro que não é do axios segue como está", async () => {
    const original = new Error("outro");
    request.mockRejectedValue(original);
    await expect(gatewayClient().status(3)).rejects.toBe(original);
  });

  it("não vaza o token na mensagem de erro", async () => {
    const err = await code(netError("ECONNREFUSED"));
    expect(err.message).not.toContain("secret-token");
  });
});
