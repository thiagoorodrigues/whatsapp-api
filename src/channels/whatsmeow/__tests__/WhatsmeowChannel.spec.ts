const client: Record<string, jest.Mock> = {
  sendMessage: jest.fn(),
  revokeMessage: jest.fn(),
  editMessage: jest.fn(),
  reactToMessage: jest.fn(),
  markRead: jest.fn(),
  setPresence: jest.fn(),
  typing: jest.fn(),
  subscribePresence: jest.fn(),
  checkNumbers: jest.fn(),
  avatar: jest.fn(),
  groupInfo: jest.fn()
};
jest.mock("../client", () => ({ gatewayClient: () => client }));

const ready = new Set<number>();
jest.mock("../state", () => ({ isReady: (id: number) => ready.has(id) }));

const cleanup = jest.fn().mockResolvedValue(undefined);
const stageOutgoing = jest.fn();
jest.mock("../media", () => ({ stageOutgoing: (...args: any[]) => stageOutgoing(...args) }));

// eslint-disable-next-line import/first
import WhatsmeowChannel from "../WhatsmeowChannel";
// eslint-disable-next-line import/first
import AppError from "../../../errors/AppError";
// eslint-disable-next-line import/first
import { wasSentByPlatform } from "../../sentByPlatform";

const sentResult = { externalId: "3EB0SENT", chatJid: "5511999999999@s.whatsapp.net", raw: { id: "3EB0SENT" } };

beforeEach(() => {
  Object.values(client).forEach(fn => fn.mockReset());
  client.sendMessage.mockResolvedValue(sentResult);
  ready.clear();
  ready.add(7);
  cleanup.mockClear();
  stageOutgoing.mockReset();
  stageOutgoing.mockResolvedValue({ path: ".gateway/out/abc.bin", cleanup });
});

const channel = () => new WhatsmeowChannel(7);

describe("prontidão", () => {
  it("falha como o Baileys quando a conexão não está conectada no gateway", () => {
    expect(() => new WhatsmeowChannel(99)).toThrow(AppError);
    expect(() => new WhatsmeowChannel(99)).toThrow("ERR_WAPP_NOT_INITIALIZED");
  });

  it("informa a prontidão pelo registro de estado", () => {
    const c = channel();
    expect(c.kind).toBe("whatsmeow");
    expect(c.connectionId).toBe(7);
    expect(c.isReady()).toBe(true);
    ready.delete(7);
    expect(c.isReady()).toBe(false);
  });

  it("cada método recusa quando a conexão caiu depois de criado o canal", async () => {
    const c = channel();
    ready.delete(7);
    await expect(c.send({ number: "1" }, { type: "text", text: "oi" })).rejects.toThrow("ERR_WAPP_NOT_INITIALIZED");
    await expect(c.markRead({ number: "1" }, [{ externalId: "A" }])).rejects.toThrow("ERR_WAPP_NOT_INITIALIZED");
    await expect(c.checkNumber("1")).rejects.toThrow("ERR_WAPP_NOT_INITIALIZED");
    await expect(c.groupInfo({ number: "120363", isGroup: true })).rejects.toThrow("ERR_WAPP_NOT_INITIALIZED");
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(client.markRead).not.toHaveBeenCalled();
  });
});

describe("send", () => {
  it("manda texto com o endereço cru e marca o id devolvido como enviado pela plataforma", async () => {
    const result = await channel().send({ number: "5511999999999", lid: "123@lid", isGroup: false }, { type: "text", text: "oi" });
    expect(client.sendMessage).toHaveBeenCalledWith(7, {
      to: { number: "5511999999999", lid: "123@lid", isGroup: false },
      content: { type: "text", text: "oi" }
    });
    expect(result).toEqual(sentResult);
    expect(wasSentByPlatform(7, "3EB0SENT")).toBe(true);
    expect(wasSentByPlatform(8, "3EB0SENT")).toBe(false);
  });

  it("usa só o jid quando o endereço já o tem", async () => {
    await channel().send({ jid: "x@s.whatsapp.net", number: "1", lid: "2@lid" }, { type: "text", text: "oi" });
    expect(client.sendMessage.mock.calls[0][1].to).toEqual({ jid: "x@s.whatsapp.net" });
  });

  it("leva as menções do texto", async () => {
    await channel().send({ number: "120363222", isGroup: true }, { type: "text", text: "oi @123", mentions: ["123@lid"] });
    expect(client.sendMessage).toHaveBeenCalledWith(7, {
      to: { number: "120363222", isGroup: true },
      content: { type: "text", text: "oi @123", mentions: ["123@lid"] }
    });
    client.sendMessage.mockClear();
    await channel().send({ number: "1" }, { type: "text", text: "oi", mentions: [] });
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({ type: "text", text: "oi" });
  });

  it("cita a mensagem guardada pelas colunas (grupo, de outra pessoa)", async () => {
    await channel().send(
      { number: "120363222", isGroup: true },
      { type: "text", text: "resposta" },
      {
        quoted: {
          externalId: "WA_Q",
          chatJid: "120363222@g.us",
          participant: "140716@lid",
          fromMe: false,
          text: "pergunta",
          raw: "{\"key\":{}}"
        }
      }
    );
    expect(client.sendMessage.mock.calls[0][1].quoted).toEqual({
      id: "WA_Q",
      chat: "120363222@g.us",
      sender: "140716@lid",
      fromMe: false,
      text: "pergunta"
    });
  });

  it("cita mensagem própria sem sender e, sem remoteJid, usa o endereço do contato", async () => {
    await channel().send(
      { number: "5511999999999", lid: "123@lid" },
      { type: "text", text: "oi" },
      { quoted: { externalId: "WA_Q", fromMe: true, participant: "5511888@s.whatsapp.net", text: null } }
    );
    expect(client.sendMessage.mock.calls[0][1].quoted).toEqual({ id: "WA_Q", chat: "123@lid", fromMe: true });
  });

  it("em conversa privada não manda sender na citação", async () => {
    await channel().send(
      { number: "5511999999999" },
      { type: "text", text: "oi" },
      { quoted: { externalId: "WA_Q", chatJid: "5511999999999@s.whatsapp.net", participant: "5511999999999@s.whatsapp.net", fromMe: false, text: "a" } }
    );
    expect(client.sendMessage.mock.calls[0][1].quoted).toEqual({
      id: "WA_Q",
      chat: "5511999999999@s.whatsapp.net",
      fromMe: false,
      text: "a"
    });
  });

  it("marca encaminhada", async () => {
    await channel().send({ number: "1" }, { type: "text", text: "oi" }, { forwarded: true });
    expect(client.sendMessage.mock.calls[0][1]).toEqual({
      to: { number: "1" },
      content: { type: "text", text: "oi" },
      forwarded: true
    });
  });

  it("imagem: grava em .gateway/out, manda path relativo, legenda e mimetype, e apaga a cópia", async () => {
    const buffer = Buffer.from("img");
    await channel().send({ number: "1" }, { type: "image", buffer, caption: "c", mimetype: "image/png" });
    expect(stageOutgoing).toHaveBeenCalledWith({ buffer }, ".png");
    expect(client.sendMessage).toHaveBeenCalledWith(7, {
      to: { number: "1" },
      content: { type: "image", caption: "c", mimetype: "image/png", path: ".gateway/out/abc.bin" }
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("imagem de arquivo sem mimetype: calcula pela extensão", async () => {
    await channel().send({ number: "1" }, { type: "image", path: "/app/public/company1/foto.jpg" });
    expect(stageOutgoing).toHaveBeenCalledWith({ path: "/app/public/company1/foto.jpg" }, ".jpg");
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({
      type: "image",
      mimetype: "image/jpeg",
      path: ".gateway/out/abc.bin"
    });
  });

  it("vídeo leva fileName", async () => {
    await channel().send({ number: "1" }, { type: "video", path: "/tmp/v.mp4", caption: "oi", fileName: "v.mp4", mimetype: "video/mp4" });
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({
      type: "video",
      caption: "oi",
      fileName: "v.mp4",
      mimetype: "video/mp4",
      path: ".gateway/out/abc.bin"
    });
  });

  it("áudio é nota de voz salvo voice:false", async () => {
    await channel().send({ number: "1" }, { type: "audio", buffer: Buffer.from("a"), mimetype: "audio/mp4", voice: true });
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({
      type: "audio",
      mimetype: "audio/mp4",
      voice: true,
      path: ".gateway/out/abc.bin"
    });
    client.sendMessage.mockClear();
    await channel().send({ number: "1" }, { type: "audio", url: "https://x/a.mp3", voice: false });
    expect(stageOutgoing).toHaveBeenLastCalledWith({ url: "https://x/a.mp3" }, ".mp3");
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({
      type: "audio",
      mimetype: "audio/mpeg",
      voice: false,
      path: ".gateway/out/abc.bin"
    });
    client.sendMessage.mockClear();
    await channel().send({ number: "1" }, { type: "audio", buffer: Buffer.from("a") });
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({
      type: "audio",
      mimetype: "audio/mp4",
      voice: true,
      path: ".gateway/out/abc.bin"
    });
  });

  it("documento leva fileName, mimetype e legenda", async () => {
    await channel().send(
      { number: "1" },
      { type: "document", buffer: Buffer.from("d"), fileName: "a.pdf", mimetype: "application/pdf", caption: "segue" }
    );
    expect(stageOutgoing).toHaveBeenCalledWith({ buffer: Buffer.from("d") }, ".pdf");
    expect(client.sendMessage.mock.calls[0][1].content).toEqual({
      type: "document",
      caption: "segue",
      fileName: "a.pdf",
      mimetype: "application/pdf",
      path: ".gateway/out/abc.bin"
    });
    client.sendMessage.mockClear();
    await channel().send({ number: "1" }, { type: "document", buffer: Buffer.from("d") });
    expect(client.sendMessage.mock.calls[0][1].content.mimetype).toBe("application/octet-stream");
  });

  it("apaga a cópia mesmo quando o envio falha", async () => {
    client.sendMessage.mockRejectedValue(new Error("ERR_GATEWAY_ERROR"));
    await expect(channel().send({ number: "1" }, { type: "image", buffer: Buffer.from("x"), mimetype: "image/png" })).rejects.toThrow(
      "ERR_GATEWAY_ERROR"
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("texto não grava arquivo", async () => {
    await channel().send({ number: "1" }, { type: "text", text: "oi" });
    expect(stageOutgoing).not.toHaveBeenCalled();
  });
});

describe("apagar, editar e reagir", () => {
  it("apaga mensagem própria no chat original", async () => {
    await channel().deleteMessage({ number: "5511999999999" }, { externalId: "WA1", chatJid: "123@lid", fromMe: true, participant: null });
    expect(client.revokeMessage).toHaveBeenCalledWith(7, "WA1", { chat: "123@lid", fromMe: true });
  });

  it("apaga mensagem de outra pessoa no grupo com sender", async () => {
    await channel().deleteMessage(
      { number: "120363222", isGroup: true },
      { externalId: "WA2", chatJid: "120363222@g.us", fromMe: false, participant: "140716@lid" }
    );
    expect(client.revokeMessage).toHaveBeenCalledWith(7, "WA2", { chat: "120363222@g.us", sender: "140716@lid", fromMe: false });
  });

  it("sem remoteJid usa o endereço do contato", async () => {
    await channel().deleteMessage({ number: "5511999999999", lid: "123@lid" }, { externalId: "WA3" });
    expect(client.revokeMessage).toHaveBeenCalledWith(7, "WA3", { chat: "123@lid", fromMe: false });
  });

  it("edita com chat e texto", async () => {
    await channel().edit({ number: "5511999999999" }, { externalId: "WA1", chatJid: "123@lid", fromMe: true }, "novo");
    expect(client.editMessage).toHaveBeenCalledWith(7, "WA1", "123@lid", "novo");
    await channel().edit({ number: "5511999999999" }, { externalId: "WA2", fromMe: true }, "x");
    expect(client.editMessage).toHaveBeenLastCalledWith(7, "WA2", "5511999999999@s.whatsapp.net", "x");
  });

  it("reage com o alvo da mensagem (grupo) e remove com emoji vazio", async () => {
    await channel().react(
      { number: "120363222", isGroup: true },
      { externalId: "WA2", chatJid: "120363222@g.us", fromMe: false, participant: "140716@lid" },
      "👍"
    );
    expect(client.reactToMessage).toHaveBeenCalledWith(7, "WA2", {
      chat: "120363222@g.us",
      sender: "140716@lid",
      fromMe: false,
      emoji: "👍"
    });
    await channel().react({ number: "5511999999999" }, { externalId: "WA1", chatJid: "5511999999999@s.whatsapp.net", fromMe: true }, "");
    expect(client.reactToMessage).toHaveBeenLastCalledWith(7, "WA1", {
      chat: "5511999999999@s.whatsapp.net",
      fromMe: true,
      emoji: ""
    });
  });
});

describe("markRead", () => {
  it("agrupa por (chat, sender), ignora as próprias e manda um POST por grupo", async () => {
    await channel().markRead({ number: "120363222", isGroup: true }, [
      { externalId: "G1", chatJid: "120363222@g.us", participant: "111@lid", fromMe: false },
      { externalId: "G2", chatJid: "120363222@g.us", participant: "222@lid", fromMe: false },
      { externalId: "G3", chatJid: "120363222@g.us", participant: "111@lid", fromMe: false },
      { externalId: "G4", chatJid: "120363222@g.us", participant: "me@lid", fromMe: true },
      { externalId: "", chatJid: "120363222@g.us", participant: "111@lid" }
    ]);
    expect(client.markRead.mock.calls).toEqual([
      [7, "120363222@g.us", ["G1", "G3"], "111@lid"],
      [7, "120363222@g.us", ["G2"], "222@lid"]
    ]);
  });

  it("conversa privada: sem sender, chat da coluna ou do endereço", async () => {
    await channel().markRead({ number: "5511999999999", lid: "123@lid" }, [
      { externalId: "D1", chatJid: "123@lid" },
      { externalId: "D2" },
      { externalId: "D3", chatJid: "5511999999999@s.whatsapp.net", fromMe: false }
    ]);
    expect(client.markRead.mock.calls).toEqual([
      [7, "123@lid", ["D1", "D2"], undefined],
      [7, "5511999999999@s.whatsapp.net", ["D3"], undefined]
    ]);
  });

  it("grupo sem participant é pulado e a falha de um grupo não impede os outros", async () => {
    client.markRead.mockRejectedValueOnce(new AppError("ERR_GATEWAY_ERROR", 400)).mockResolvedValue(undefined);
    await expect(
      channel().markRead({ number: "120363222", isGroup: true }, [
        { externalId: "G0", chatJid: "120363222@g.us", fromMe: false },
        { externalId: "G1", chatJid: "120363222@g.us", participant: "111@lid", fromMe: false },
        { externalId: "G2", chatJid: "120363222@g.us", participant: "222@lid", fromMe: false }
      ])
    ).resolves.toBeUndefined();
    expect(client.markRead.mock.calls).toEqual([
      [7, "120363222@g.us", ["G1"], "111@lid"],
      [7, "120363222@g.us", ["G2"], "222@lid"]
    ]);
  });

  it("nada a marcar não chama o gateway", async () => {
    await channel().markRead({ number: "1" }, []);
    await channel().markRead({ number: "1" }, [{ externalId: "X", fromMe: true }]);
    expect(client.markRead).not.toHaveBeenCalled();
  });
});

describe("presença e digitando", () => {
  it("define a presença da conta", async () => {
    await channel().setPresence("available");
    expect(client.setPresence).toHaveBeenCalledWith(7, "available");
  });

  it("digitando assina a presença antes; gravando e pausado", async () => {
    const c = channel();
    await c.sendTyping({ number: "5511999999999", lid: "123@lid" }, true);
    expect(client.subscribePresence).toHaveBeenCalledWith(7, "123@lid");
    expect(client.typing).toHaveBeenCalledWith(7, "123@lid", "composing");
    expect(client.subscribePresence.mock.invocationCallOrder[0]).toBeLessThan(client.typing.mock.invocationCallOrder[0]);

    await c.sendTyping({ number: "5511999999999" }, "recording");
    expect(client.typing).toHaveBeenLastCalledWith(7, "5511999999999@s.whatsapp.net", "recording");
    expect(client.subscribePresence).toHaveBeenCalledTimes(2);

    await c.sendTyping({ number: "5511999999999" }, false);
    expect(client.typing).toHaveBeenLastCalledWith(7, "5511999999999@s.whatsapp.net", "paused");
    expect(client.subscribePresence).toHaveBeenCalledTimes(2);
  });

  it("acompanha a presença do contato", async () => {
    await channel().watchPresence({ number: "120363222", isGroup: true });
    expect(client.subscribePresence).toHaveBeenCalledWith(7, "120363222@g.us");
  });
});

describe("checkNumber", () => {
  it("manda só os dígitos e devolve exists/jid", async () => {
    client.checkNumbers.mockResolvedValue([{ number: "5511999999999", exists: true, jid: "5511999999999@s.whatsapp.net" }]);
    expect(await channel().checkNumber("+55 (11) 99999-9999")).toEqual({ exists: true, jid: "5511999999999@s.whatsapp.net" });
    expect(client.checkNumbers).toHaveBeenCalledWith(7, ["5511999999999"]);
    client.checkNumbers.mockResolvedValue([{ number: "1", exists: false }]);
    expect(await channel().checkNumber("1")).toEqual({ exists: false });
    client.checkNumbers.mockResolvedValue([]);
    expect(await channel().checkNumber("2")).toEqual({ exists: false });
  });
});

describe("profilePictureUrl", () => {
  it("devolve a url e guarda no cache por conexão", async () => {
    client.avatar.mockResolvedValue("https://pps.whatsapp.net/a.jpg");
    const c = channel();
    expect(await c.profilePictureUrl({ number: "5511900000001" })).toBe("https://pps.whatsapp.net/a.jpg");
    expect(await c.profilePictureUrl({ number: "5511900000001" })).toBe("https://pps.whatsapp.net/a.jpg");
    expect(client.avatar).toHaveBeenCalledTimes(1);
    expect(client.avatar).toHaveBeenCalledWith(7, "5511900000001@s.whatsapp.net");
  });

  it("url vazia vira null", async () => {
    client.avatar.mockResolvedValue("");
    expect(await channel().profilePictureUrl({ number: "5511900000002" })).toBeNull();
  });
});

describe("grupos", () => {
  it("groupInfo converte createdAt e descrição; participantes como vêm do gateway", async () => {
    client.groupInfo.mockResolvedValue({
      subject: "Suporte",
      description: "  Regras do grupo \n",
      createdAt: "2023-11-14T22:13:20Z",
      participants: [
        { jid: "140716@lid", lid: "140716@lid", phone: "5531991147761", isAdmin: true, isMe: false },
        { jid: "888@lid", lid: "888@lid", isAdmin: false, isMe: true }
      ]
    });
    const info = await channel().groupInfo({ number: "120363000", isGroup: true });
    expect(client.groupInfo).toHaveBeenCalledWith(7, "120363000@g.us");
    expect(info).toEqual({
      subject: "Suporte",
      description: "Regras do grupo",
      createdAt: new Date(1700000000 * 1000),
      participants: [
        { jid: "140716@lid", lid: "140716@lid", phone: "5531991147761", isAdmin: true, isMe: false },
        { jid: "888@lid", lid: "888@lid", isAdmin: false, isMe: true }
      ]
    });
  });

  it("sem data nem descrição: null; usa o jid do endereço; cache de 10 min por conexão", async () => {
    client.groupInfo.mockResolvedValue({ subject: "", description: "", createdAt: null, participants: [] });
    const c = channel();
    const info = await c.groupInfo({ jid: "120363111@g.us", number: "x", isGroup: true });
    expect(info).toEqual({ subject: "", description: null, createdAt: null, participants: [] });
    expect(client.groupInfo).toHaveBeenCalledWith(7, "120363111@g.us");
    await c.groupParticipants({ jid: "120363111@g.us", isGroup: true });
    expect(client.groupInfo).toHaveBeenCalledTimes(1);
  });

  it("groupParticipants devolve só os membros", async () => {
    client.groupInfo.mockResolvedValue({
      subject: "G",
      description: "",
      createdAt: "lixo",
      participants: [{ jid: "5521988887777@s.whatsapp.net", phone: "5521988887777", isAdmin: false, isMe: false }]
    });
    expect(await channel().groupParticipants({ number: "120363222", isGroup: true })).toEqual([
      { jid: "5521988887777@s.whatsapp.net", phone: "5521988887777", isAdmin: false, isMe: false }
    ]);
    expect((await channel().groupInfo({ number: "120363222", isGroup: true })).createdAt).toBeNull();
  });
});
