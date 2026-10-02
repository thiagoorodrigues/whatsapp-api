const findAll = jest.fn();

jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAll(...a) } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: {} }));
jest.mock("../ResolveMentionsService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ to: () => ({ to: () => ({ emit: jest.fn() }) }) }) }) }));

// eslint-disable-next-line import/first
import UpdateMessageService from "../UpdateMessageService";

describe("UpdateMessageService", () => {
  it("edits only the copy of the connection that received the edit", async () => {
    const ticket = { update: jest.fn(), lastMessage: "" };
    findAll.mockResolvedValue([{ update: jest.fn(), ticket, ticketId: 8, mentions: [] }]);
    await UpdateMessageService({ messageData: { id: "x", messagesWhatsappsId: "A1", ticketId: 8, body: "Oi!" }, companyId: 2, whatsappId: 4 });
    expect(findAll.mock.calls[0][0].where).toEqual({ messagesWhatsappsId: "A1", companyId: 2, whatsappId: 4 });
  });
});
