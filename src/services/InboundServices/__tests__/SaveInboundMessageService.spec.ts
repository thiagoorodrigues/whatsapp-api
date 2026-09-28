const create = jest.fn(async ({ messageData }: any) => messageData);
const updateMessage = jest.fn();
const saveMedia = jest.fn();
const emit = jest.fn();
const findQuoted = jest.fn();

jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: (a: any) => create(a) }));
jest.mock("../../MessageServices/UpdateMessageService", () => ({ __esModule: true, default: (a: any) => updateMessage(a) }));
jest.mock("../../../helpers/mediaStorage", () => ({ saveCompanyMedia: (...a: any[]) => saveMedia(...a) }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit, to: () => ({ emit }) }) }) }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findQuoted(...a) } }));
["Contact", "Queue", "Ticket", "User"].forEach(m => jest.mock(`../../../models/${m}`, () => ({})));

// eslint-disable-next-line import/first
import SaveInboundMessageService from "../SaveInboundMessageService";

const ticket = (status = "open"): any => ({
  id: 8,
  companyId: 1,
  status,
  contact: { name: "Thiago", number: "5531991147761" },
  update: jest.fn(async function update(this: any, v: any) { Object.assign(this, v); }),
  reload: jest.fn()
});
const contact: any = { id: 3 };

const inbound = (over: any = {}): any => ({
  connectionId: 2,
  companyId: 1,
  externalId: "A1",
  fromMe: false,
  timestamp: 1700000000000,
  chat: { jid: "140716097450191@lid", isGroup: false },
  sender: { jid: "5531991147761@s.whatsapp.net" },
  kind: "text",
  channelType: "conversation",
  text: "Oi",
  hasMedia: false,
  raw: { key: { id: "A1", participant: null }, status: 3 },
  ...over
});

beforeEach(() => {
  create.mockClear();
  updateMessage.mockClear();
  saveMedia.mockReset();
  findQuoted.mockReset().mockResolvedValue(null);
  emit.mockClear();
});

describe("SaveInboundMessageService", () => {
  it("saves a received text with its quote", async () => {
    findQuoted.mockResolvedValue({ id: "uuid-q" });
    const t = ticket();
    await SaveInboundMessageService(inbound({ quotedExternalId: "Q1" }), t, contact);
    expect(create).toHaveBeenCalledWith({
      companyId: 1,
      messageData: expect.objectContaining({
        messagesWhatsappsId: "A1",
        ticketId: 8,
        contactId: 3,
        body: "Oi",
        fromMe: false,
        read: false,
        mediaType: "conversation",
        quotedMsgId: "uuid-q",
        ack: 3,
        remoteJid: "140716097450191@lid",
        isEdited: false,
        createdAt: "2023-11-14T22:13:20.000Z"
      })
    });
    expect(t.update).toHaveBeenCalledWith({ lastMessage: "Oi" });
  });

  it("stores media in the company folder, named after the original file", async () => {
    saveMedia.mockResolvedValue("company1/123_ab_boleto.pdf");
    const loadMedia = jest.fn().mockResolvedValue({ data: Buffer.from("pdf"), mimetype: "application/pdf", fileName: "boleto.pdf" });
    await SaveInboundMessageService(inbound({ hasMedia: true, kind: "document", text: "", loadMedia }), ticket(), contact);
    expect(saveMedia).toHaveBeenCalledWith(1, expect.any(Buffer), "boleto.pdf", "application/pdf");
    expect(create.mock.calls[0][0].messageData).toEqual(
      expect.objectContaining({ body: "boleto.pdf", mediaUrl: "company1/123_ab_boleto.pdf", mediaType: "application" })
    );
  });

  it("keeps the message when the file is gone", async () => {
    await SaveInboundMessageService(
      inbound({ hasMedia: true, kind: "image", text: "foto", loadMedia: async () => null }),
      ticket(),
      contact
    );
    expect(create.mock.calls[0][0].messageData).toEqual(expect.objectContaining({ body: "foto", mediaUrl: undefined, mediaType: "image" }));
  });

  it("applies edits to the original message", async () => {
    await SaveInboundMessageService(inbound({ externalId: "E1", editOf: "A1", text: "Oi!" }), ticket(), contact);
    expect(create).not.toHaveBeenCalled();
    expect(updateMessage).toHaveBeenCalledWith({
      companyId: 1,
      messageData: expect.objectContaining({ messagesWhatsappsId: "A1", body: "Oi!", isEdited: true })
    });
  });

  it("reopens a closed ticket when the customer writes, not for our own messages", async () => {
    const closed = ticket("closed");
    await SaveInboundMessageService(inbound(), closed, contact);
    expect(closed.status).toBe("pending");
    const ours = ticket("closed");
    await SaveInboundMessageService(inbound({ fromMe: true }), ours, contact);
    expect(ours.status).toBe("closed");
    expect(create.mock.calls[1][0].messageData).toEqual(expect.objectContaining({ contactId: undefined, read: true, ack: 2 }));
  });
});
