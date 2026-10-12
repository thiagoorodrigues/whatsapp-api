import { toInbound, GatewayMessageEnvelope } from "../toInbound";
import AppError from "../../../errors/AppError";

jest.mock("../../../config/whatsappEngine", () => ({
  gatewayConfig: () => ({ url: "x", token: "t", mediaRoot: "/nonexistent" })
}));

const LID = "1234567890123@lid";
const PHONE = "5511999990000@s.whatsapp.net";

const envelope = (data: Record<string, any>, connectionId = 7): GatewayMessageEnvelope => ({
  type: "message",
  connectionId,
  ts: 1760000000000,
  data: {
    id: "ABC123",
    fromMe: false,
    history: false,
    timestamp: 1760000000000,
    chat: { jid: PHONE, isGroup: false },
    sender: { jid: PHONE, name: "Maria" },
    kind: "text",
    channelType: "conversation",
    text: "oi",
    hasMedia: false,
    forwarded: false,
    mentions: [],
    raw: {
      key: { id: "ABC123", remoteJid: PHONE, fromMe: false },
      message: { conversation: "oi" },
      pushName: "Maria",
      messageTimestamp: 1760000000
    },
    ...data
  }
});

const deps = (over: Record<string, any> = {}) => ({
  client: { downloadMedia: jest.fn() } as any,
  lookupLid: jest.fn().mockResolvedValue(undefined),
  ...over
});

describe("toInbound (gateway)", () => {
  it("mensagem privada de texto", async () => {
    const d = deps();
    const env = envelope({});
    const m = await toInbound(env, 3, d);
    expect(m).toMatchObject({
      connectionId: 7,
      companyId: 3,
      externalId: "ABC123",
      fromMe: false,
      history: false,
      timestamp: 1760000000000,
      chat: { jid: PHONE, isGroup: false },
      sender: { jid: PHONE, name: "Maria" },
      kind: "text",
      channelType: "conversation",
      text: "oi",
      hasMedia: false,
      forwarded: false,
      mentions: []
    });
    expect(m!.loadMedia).toBeUndefined();
    expect(m!.quotedExternalId).toBeUndefined();
    expect(m!.editOf).toBeUndefined();
    expect(m!.raw).toBe(env.data.raw);
    expect(d.lookupLid).not.toHaveBeenCalled();
  });

  it("grupo com menções e citação", async () => {
    const d = deps();
    const m = await toInbound(
      envelope({
        chat: { jid: "120363000000000000@g.us", isGroup: true, name: "Equipe" },
        sender: { jid: PHONE, name: "João" },
        text: "@5511888880000 veja",
        mentions: ["5511888880000@s.whatsapp.net"],
        quotedId: "QUOTED1",
        channelType: "extendedTextMessage"
      }),
      3,
      d
    );
    expect(m!.chat).toEqual({ jid: "120363000000000000@g.us", isGroup: true, name: "Equipe" });
    expect(m!.mentions).toEqual(["5511888880000@s.whatsapp.net"]);
    expect(m!.quotedExternalId).toBe("QUOTED1");
    expect(m!.sender.name).toBe("João");
  });

  it("mídia: loadMedia chama o gateway com raw.message", async () => {
    const d = deps();
    const loader = jest
      .spyOn(require("../media"), "loadIncoming")
      .mockResolvedValue({ data: Buffer.from("x"), mimetype: "image/jpeg", fileName: "a.jpg" });
    const env = envelope({
      kind: "image",
      channelType: "imageMessage",
      hasMedia: true,
      media: { mimetype: "image/jpeg", fileName: "a.jpg" },
      raw: { key: { id: "ABC123", remoteJid: PHONE, fromMe: false }, message: { imageMessage: { url: "u" } } }
    });
    const m = await toInbound(env, 3, d);
    expect(m!.kind).toBe("image");
    expect(m!.hasMedia).toBe(true);
    const media = await m!.loadMedia!();
    expect(media!.mimetype).toBe("image/jpeg");
    expect(loader).toHaveBeenCalledWith(d.client, 7, { imageMessage: { url: "u" } });
    loader.mockRestore();
  });

  it("mídia sem arquivo no gateway devolve null", async () => {
    const d = deps();
    d.client.downloadMedia.mockResolvedValue(null);
    const m = await toInbound(
      envelope({ kind: "audio", channelType: "audioMessage", hasMedia: true, raw: { message: { audioMessage: {} } } }),
      3,
      d
    );
    expect(await m!.loadMedia!()).toBeNull();
    expect(d.client.downloadMedia).toHaveBeenCalledWith(7, { audioMessage: {} });
  });

  it("edição", async () => {
    const m = await toInbound(envelope({ channelType: "editedMessage", editOf: "ORIG1", text: "novo" }), 3, deps());
    expect(m!.editOf).toBe("ORIG1");
    expect(m!.channelType).toBe("editedMessage");
    expect(m!.text).toBe("novo");
  });

  it("fromMe pelo celular em privado mantém o contato como sender", async () => {
    const m = await toInbound(
      envelope({ fromMe: true, sender: { jid: PHONE, name: "5511999990000" } }),
      3,
      deps()
    );
    expect(m!.fromMe).toBe(true);
    expect(m!.sender).toEqual({ jid: PHONE, name: "5511999990000" });
  });

  it("remetente só em LID é resolvido pelo lookup", async () => {
    const d = deps({ lookupLid: jest.fn().mockResolvedValue(PHONE) });
    const m = await toInbound(
      envelope({ chat: { jid: LID, isGroup: false }, sender: { jid: "1234567890123:5@lid", name: "Ana", lid: LID } }),
      3,
      d
    );
    expect(d.lookupLid).toHaveBeenCalledWith(LID, 3);
    expect(m!.sender).toEqual({ jid: PHONE, name: "Ana", lid: LID });
  });

  it("LID desconhecido mantém o LID", async () => {
    const d = deps();
    const m = await toInbound(envelope({ sender: { jid: LID, name: "Ana" } }), 3, d);
    expect(m!.sender.jid).toBe(LID);
    expect(m!.sender.lid).toBe(LID);
  });

  it("history é respeitado", async () => {
    const m = await toInbound(envelope({ history: true }), 3, deps());
    expect(m!.history).toBe(true);
  });

  it("kind desconhecido vira other e status@broadcast é ignorado", async () => {
    expect((await toInbound(envelope({ kind: "poll" }), 3, deps()))!.kind).toBe("other");
    expect(await toInbound(envelope({ chat: { jid: "status@broadcast", isGroup: false } }), 3, deps())).toBeNull();
  });

  describe("falha ao baixar a mídia", () => {
    const mediaEnvelope = () =>
      envelope({ kind: "image", channelType: "imageMessage", hasMedia: true, raw: { message: { imageMessage: {} } } });

    it.each(["ERR_GATEWAY_UNAVAILABLE", "ERR_WAPP_NOT_INITIALIZED"])(
      "erro transitório (%s) é relançado (o consumer tenta de novo)",
      async code => {
        const d = deps();
        d.client.downloadMedia.mockRejectedValue(new AppError(code, 503));
        const m = await toInbound(mediaEnvelope(), 3, d);
        await expect(m!.loadMedia!()).rejects.toMatchObject({ message: code });
      }
    );

    it("erro definitivo do gateway devolve null (mensagem gravada sem o arquivo, como o Baileys)", async () => {
      const d = deps();
      d.client.downloadMedia.mockRejectedValue(new AppError("ERR_GATEWAY_ERROR", 502));
      const m = await toInbound(mediaEnvelope(), 3, d);
      await expect(m!.loadMedia!()).resolves.toBeNull();
    });

    it("erro comum (arquivo ilegível, caminho ruim) devolve null", async () => {
      const d = deps();
      d.client.downloadMedia.mockRejectedValue(new Error("ENOENT"));
      const m = await toInbound(mediaEnvelope(), 3, d);
      await expect(m!.loadMedia!()).resolves.toBeNull();
    });
  });

  it("mentions nulo vira lista vazia", async () => {
    const m = await toInbound(envelope({ mentions: null }), 3, deps());
    expect(m!.mentions).toEqual([]);
  });
});
