const download = jest.fn();
const contactFindOne = jest.fn();
const messageFindOne = jest.fn();

jest.mock("@whiskeysockets/baileys", () => ({
  getContentType: (m: any) => (m ? Object.keys(m).find(k => k !== "messageContextInfo") : undefined),
  jidNormalizedUser: (j: string) => (j ? j.replace(/:\d+@/, "@") : j),
  extractMessageContent: (m: any) => m,
  downloadMediaMessage: (...args: any[]) => download(...args),
  WAMessageStubType: { REVOKE: 1, E2E_DEVICE_CHANGED: 2, E2E_IDENTITY_CHANGED: 3, CIPHERTEXT: 4 }
}));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: (...a: any[]) => contactFindOne(...a) } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => messageFindOne(...a) } }));
jest.mock("../../../libs/whatsappCache", () => ({
  getGroupMetadata: async (_w: any, jid: string) => ({ id: jid, subject: "Equipe Vendas" })
}));

// eslint-disable-next-line import/first
import toInbound from "../toInbound";
// eslint-disable-next-line import/first
import { normalizedForWebhook } from "../../inbound";

const wbot: any = { id: 2, user: { id: "5511888888888:4@s.whatsapp.net", name: "Loja" } };

beforeEach(() => {
  download.mockReset();
  contactFindOne.mockReset().mockResolvedValue(null);
  messageFindOne.mockReset().mockResolvedValue(null);
});

describe("toInbound", () => {
  it("reads a customer text arriving by LID with the phone in senderPn", async () => {
    const inbound = await toInbound(
      {
        key: { id: "A1", fromMe: false, remoteJid: "140716097450191@lid", senderPn: "5531991147761@s.whatsapp.net" } as any,
        message: { conversation: "Oi" },
        messageTimestamp: 1700000000,
        pushName: "Thiago"
      },
      wbot,
      1
    );
    expect(inbound).toEqual(
      expect.objectContaining({
        connectionId: 2,
        companyId: 1,
        externalId: "A1",
        fromMe: false,
        timestamp: 1700000000000,
        chat: { jid: "140716097450191@lid", isGroup: false, name: undefined },
        sender: { jid: "5531991147761@s.whatsapp.net", name: "Thiago", lid: "140716097450191@lid" },
        kind: "text",
        channelType: "conversation",
        text: "Oi",
        hasMedia: false
      })
    );
  });

  it("does not rename the contact after our own messages", async () => {
    const inbound = await toInbound(
      { key: { id: "A2", fromMe: true, remoteJid: "5531991147761@s.whatsapp.net" }, message: { conversation: "ok" }, pushName: "Loja" },
      wbot,
      1
    );
    expect(inbound.sender).toEqual({ jid: "5531991147761@s.whatsapp.net", name: "5531991147761", lid: undefined });
  });

  it("resolves a group member known only by LID through the stored contact", async () => {
    contactFindOne.mockResolvedValue({ number: "5531991147761" });
    const inbound = await toInbound(
      {
        key: { id: "G1", fromMe: false, remoteJid: "120363430882999421@g.us", participant: "140716097450191@lid" },
        message: { extendedTextMessage: { text: "bom dia" } },
        pushName: "Thiago"
      },
      wbot,
      1
    );
    expect(inbound.chat).toEqual({ jid: "120363430882999421@g.us", isGroup: true, name: "Equipe Vendas" });
    expect(inbound.sender).toEqual({ jid: "5531991147761@s.whatsapp.net", name: "Thiago", lid: "140716097450191@lid" });
    expect(contactFindOne).toHaveBeenCalledWith(expect.objectContaining({ where: { lid: "140716097450191@lid", companyId: 1 } }));
  });

  it("uses the account itself as sender of our own group messages", async () => {
    const inbound = await toInbound(
      { key: { id: "G2", fromMe: true, remoteJid: "120363430882999421@g.us" }, message: { conversation: "oi grupo" } },
      wbot,
      1
    );
    expect(inbound.sender).toEqual({ jid: "5511888888888@s.whatsapp.net", name: "Loja" });
  });

  it("loads media only when asked", async () => {
    download.mockResolvedValue(Buffer.from("jpg"));
    const inbound = await toInbound(
      { key: { id: "M1", fromMe: false, remoteJid: "5531991147761@s.whatsapp.net" }, message: { imageMessage: { mimetype: "image/jpeg", caption: "nota" } } as any },
      wbot,
      1
    );
    expect(inbound.hasMedia).toBe(true);
    expect(inbound.text).toBe("nota");
    expect(download).not.toHaveBeenCalled();
    const media = await inbound.loadMedia();
    expect(media.data.toString()).toBe("jpg");
    expect(media.mimetype).toBe("image/jpeg");
    expect(media.fileName).toMatch(/^\d+\.jpeg$/);
  });

  it("returns null when the file is gone and ignores status broadcasts", async () => {
    download.mockRejectedValue(new Error("410"));
    const inbound = await toInbound(
      { key: { id: "M2", fromMe: false, remoteJid: "5531991147761@s.whatsapp.net" }, message: { documentMessage: { mimetype: "application/pdf", fileName: "boleto.pdf" } } as any },
      wbot,
      1
    );
    expect(await inbound.loadMedia()).toBeNull();
    expect(await toInbound({ key: { id: "S", remoteJid: "status@broadcast" }, message: { conversation: "x" } }, wbot, 1)).toBeNull();
  });

  it("marks edits with the id of the original message", async () => {
    const inbound = await toInbound(
      {
        key: { id: "E1", fromMe: false, remoteJid: "5531991147761@s.whatsapp.net" },
        message: { protocolMessage: { key: { id: "A1" }, editedMessage: { conversation: "Oi, tudo bem?" } } } as any
      },
      wbot,
      1
    );
    expect(inbound.editOf).toBe("A1");
    expect(inbound.text).toBe("Oi, tudo bem?");
  });
  it("lists the mentioned jids of a group message", async () => {
    const inbound = await toInbound(
      {
        key: { id: "M1", fromMe: false, remoteJid: "120363430882999421@g.us", participant: "5531991147761@s.whatsapp.net" } as any,
        message: {
          extendedTextMessage: {
            text: "@140716097450191 olha isso",
            contextInfo: { mentionedJid: ["140716097450191@lid"] }
          }
        },
        messageTimestamp: 1700000000,
        pushName: "Thiago"
      },
      wbot,
      1
    );
    expect(inbound.mentions).toEqual(["140716097450191@lid"]);
    expect(normalizedForWebhook(inbound).mentions).toEqual(["140716097450191@lid"]);
  });

  it("has no mentions on a plain text", async () => {
    const inbound = await toInbound(
      { key: { id: "M2", fromMe: false, remoteJid: "5531991147761@s.whatsapp.net" } as any, message: { conversation: "Oi" }, messageTimestamp: 1 },
      wbot,
      1
    );
    expect(inbound.mentions).toEqual([]);
  });
});
