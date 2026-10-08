const findOne = jest.fn();
const edit = jest.fn();
const emit = jest.fn();

jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findOne(...a) } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: {} }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit }) }) }));
jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ edit: (...a: any[]) => edit(...a) }),
  ticketAddress: () => ({ number: "5511999999999" }),
  messageRef: (m: any) => ({ externalId: m.messagesWhatsappsId })
}));

// eslint-disable-next-line import/first
import EditMessageService from "../EditMessageService";

const message = (extra: any = {}): any => {
  const ticket: any = { lastMessage: "*Ana:*\noi", update: jest.fn() };
  const m: any = {
    id: 7,
    ticketId: 5,
    fromMe: true,
    mediaType: "extendedTextMessage",
    messagesWhatsappsId: "M1",
    body: "*Ana:*\noi",
    createdAt: new Date(),
    ticket,
    ...extra
  };
  m.update = jest.fn(async (v: any) => Object.assign(m, v));
  return m;
};

beforeEach(() => jest.clearAllMocks());

describe("EditMessageService", () => {
  it("edits on WhatsApp keeping the signature", async () => {
    const m = message();
    findOne.mockResolvedValue(m);
    await EditMessageService({ messageId: 7, companyId: 1, body: " olá " });
    expect(findOne.mock.calls[0][0].where).toEqual({ id: 7, companyId: 1 });
    expect(edit).toHaveBeenCalledWith({ number: "5511999999999" }, { externalId: "M1" }, "*Ana:*\nolá");
    expect(m.update).toHaveBeenCalledWith({ body: "*Ana:*\nolá", isEdited: true });
    expect(m.ticket.update).toHaveBeenCalledWith({ lastMessage: "*Ana:*\nolá" });
    expect(emit).toHaveBeenCalledWith("company-1-appMessage", { action: "update", message: m });
  });

  it("a message without signature stays without", async () => {
    const m = message({ body: "oi" });
    findOne.mockResolvedValue(m);
    await EditMessageService({ messageId: 7, companyId: 1, body: "olá" });
    expect(edit.mock.calls[0][2]).toBe("olá");
  });

  it("refuses after 15 minutes, received messages and media", async () => {
    for (const extra of [
      { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
      { fromMe: false },
      { mediaType: "image", mediaUrl: "x.jpg" }
    ]) {
      findOne.mockResolvedValue(message(extra));
      // eslint-disable-next-line no-await-in-loop
      await expect(EditMessageService({ messageId: 7, companyId: 1, body: "olá" })).rejects.toBeTruthy();
    }
    expect(edit).not.toHaveBeenCalled();
  });
});
