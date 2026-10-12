jest.mock("../../models/Contact", () => ({}));
jest.mock("../../models/Ticket", () => ({}));
jest.mock("../../helpers/GetDefaultWhatsApp", () => ({}));
jest.mock("../../helpers/GetDefaultWhatsAppByUser", () => ({}));
jest.mock("../baileys/BaileysChannel", () => ({ __esModule: true, default: class {} }));

// eslint-disable-next-line import/first
import { messageRef } from "..";

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
