const chatModify = jest.fn();
const findAll = jest.fn();

jest.mock("../../libs/wbot", () => ({ getWbot: () => ({ chatModify, user: { id: "5511888888888:1@s.whatsapp.net" } }) }));
jest.mock("../../libs/socket", () => ({ getIO: () => ({ to: () => ({ to: () => ({ emit: jest.fn() }) }) }) }));
jest.mock("../../models/Ticket", () => ({}));
jest.mock("../../models/Message", () => ({
  __esModule: true,
  default: { findAll: (...args: any[]) => findAll(...args), update: jest.fn() }
}));

// eslint-disable-next-line import/first
import SetTicketMessagesAsRead from "../SetTicketMessagesAsRead";

const ticket: any = {
  id: 1,
  whatsappId: 3,
  companyId: 1,
  status: "open",
  isGroup: false,
  contact: { number: "5511999999999", lid: null, isGroup: false },
  update: jest.fn()
};

const raw = { key: { id: "WA1", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" }, messageTimestamp: 1700000000 };

beforeEach(() => {
  chatModify.mockClear();
  findAll.mockReset();
});

describe("SetTicketMessagesAsRead", () => {
  it("marks the chat read with the last received message", async () => {
    findAll.mockResolvedValue([{ dataJson: null }, { dataJson: JSON.stringify(raw), messagesWhatsappsId: "WA1" }]);
    await SetTicketMessagesAsRead(ticket);
    expect(chatModify).toHaveBeenCalledWith(
      { markRead: true, lastMessages: [raw] },
      "5511999999999@s.whatsapp.net"
    );
  });

  it("does nothing on WhatsApp when there is no raw message", async () => {
    findAll.mockResolvedValue([{ dataJson: null }]);
    await SetTicketMessagesAsRead(ticket);
    expect(chatModify).not.toHaveBeenCalled();
    expect(ticket.update).toHaveBeenCalledWith({ unreadMessages: 0 });
  });
});
