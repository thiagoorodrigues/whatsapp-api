const create = jest.fn(async ({ messageData }: any) => messageData);
const upload = jest.fn();
const cacheSet = jest.fn();

jest.mock("../CreateMessageService", () => ({ __esModule: true, default: (args: any) => create(args) }));
jest.mock("../../../config/uploadAws", () => ({ uploadToS3: (...args: any[]) => upload(...args) }));
jest.mock("../../../libs/cache", () => ({ cacheLayer: { set: (...args: any[]) => cacheSet(...args) } }));
jest.mock("../../../channels", () => ({}));
jest.mock("../../../models/Message", () => ({}));
jest.mock("../../../models/Ticket", () => ({}));

// eslint-disable-next-line import/first
import SaveSentMessageService from "../SaveSentMessageService";

const ticket: any = { id: 5, companyId: 1, contactId: 9, update: jest.fn() };
const sent = { externalId: "3EB0ABC", chatJid: "123@lid", raw: { key: { id: "3EB0ABC" } } };

beforeEach(() => {
  create.mockClear();
  upload.mockReset();
  ticket.update.mockClear();
});

describe("SaveSentMessageService", () => {
  it("saves a sent text as the echo used to", async () => {
    const saved: any = await SaveSentMessageService({ ticket, sent, body: "Olá", quotedMsgId: "q1" });
    expect(saved).toEqual(
      expect.objectContaining({
        messagesWhatsappsId: "3EB0ABC",
        ticketId: 5,
        body: "Olá",
        fromMe: true,
        read: true,
        mediaType: "extendedTextMessage",
        ack: 1,
        quotedMsgId: "q1",
        remoteJid: "123@lid",
        dataJson: JSON.stringify(sent.raw),
        isAws: false
      })
    );
    expect(ticket.update).toHaveBeenCalledWith({ lastMessage: "Olá", fromMe: true });
    expect(cacheSet).toHaveBeenCalledWith("contacts:9:unreads", "0");
  });

  it("stores sent media in S3", async () => {
    const saved: any = await SaveSentMessageService({
      ticket,
      sent,
      media: { buffer: Buffer.from("x"), mimetype: "application/pdf", fileName: "boleto maio.pdf" }
    });
    expect(upload).toHaveBeenCalledWith(expect.any(Buffer), saved.mediaUrl);
    expect(saved.mediaUrl).toMatch(/^\d+_boleto_maio\.pdf$/);
    expect(saved).toEqual(expect.objectContaining({ mediaType: "application", isAws: true, body: saved.mediaUrl }));
  });

  it("still saves the message when the upload fails", async () => {
    upload.mockRejectedValue(new Error("s3 down"));
    const saved: any = await SaveSentMessageService({
      ticket,
      sent,
      body: "foto",
      media: { buffer: Buffer.from("x"), mimetype: "image/jpeg" }
    });
    expect(saved.mediaUrl).toMatch(/^\d+\.jpeg$/);
    expect(saved.body).toBe("foto");
  });
});
