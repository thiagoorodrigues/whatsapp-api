jest.mock("../../models/Contact", () => ({}));
jest.mock("../../models/Ticket", () => ({}));
jest.mock("../../helpers/GetDefaultWhatsApp", () => ({}));
jest.mock("../../helpers/GetDefaultWhatsAppByUser", () => ({}));
jest.mock("../baileys/BaileysChannel", () => ({
  __esModule: true,
  default: class {
    readonly kind = "baileys";

    constructor(readonly connectionId: number) {}
  }
}));
jest.mock("../whatsmeow/WhatsmeowChannel", () => ({
  __esModule: true,
  default: class {
    readonly kind = "whatsmeow";

    constructor(readonly connectionId: number) {}
  }
}));
let whatsmeow = false;
jest.mock("../../config/whatsappEngine", () => ({ isWhatsmeow: () => whatsmeow }));

// eslint-disable-next-line import/first
import { getChannel, messageRef } from "..";

describe("getChannel", () => {
  it("usa o Baileys no motor padrão", () => {
    whatsmeow = false;
    const channel = getChannel(5);
    expect(channel.kind).toBe("baileys");
    expect(channel.connectionId).toBe(5);
  });

  it("usa o gateway com WHATSAPP_ENGINE=whatsmeow", () => {
    whatsmeow = true;
    const channel = getChannel(6);
    expect(channel.kind).toBe("whatsmeow");
    expect(channel.connectionId).toBe(6);
  });
});

describe("messageRef", () => {
  it("leva o texto (body) para os canais que citam sem o payload bruto", () => {
    const ref = messageRef({
      messagesWhatsappsId: "WA1",
      remoteJid: "123@lid",
      participant: null,
      fromMe: false,
      body: "olá",
      dataJson: "{}"
    });
    expect(ref).toEqual({
      externalId: "WA1",
      chatJid: "123@lid",
      participant: null,
      fromMe: false,
      text: "olá",
      raw: "{}"
    });
  });

  it("aceita mensagem sem body", () => {
    expect(messageRef({ messagesWhatsappsId: "WA2" }).text).toBeUndefined();
  });
});
