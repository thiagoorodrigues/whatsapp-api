const readMessages = jest.fn();
const findAll = jest.fn();
const update = jest.fn();

jest.mock("../../libs/wbot", () => ({
  getWbot: () => ({ readMessages, user: { id: "5511888888888:1@s.whatsapp.net" } })
}));
jest.mock("../../libs/socket", () => ({ getIO: () => ({ to: () => ({ to: () => ({ emit: jest.fn() }) }) }) }));
jest.mock("../../models/Ticket", () => ({}));
const cacheSet = jest.fn();
jest.mock("../../libs/cache", () => ({ cacheLayer: { set: (...args: any[]) => cacheSet(...args) } }));
jest.mock("../../models/Message", () => ({
  __esModule: true,
  default: { findAll: (...args: any[]) => findAll(...args), update: (...args: any[]) => update(...args) }
}));

// eslint-disable-next-line import/first
import SetTicketMessagesAsRead from "../SetTicketMessagesAsRead";

const ticket: any = {
  id: 1,
  whatsappId: 3,
  companyId: 1,
  status: "open",
  isGroup: false,
  contact: { number: "5511999999999", lid: "140716097450191@lid", isGroup: false },
  update: jest.fn()
};

const raw = { key: { id: "WA1", fromMe: false, remoteJid: "140716097450191@lid" }, messageTimestamp: 1700000000 };

beforeEach(() => {
  readMessages.mockReset();
  findAll.mockReset();
  update.mockClear();
});

describe("SetTicketMessagesAsRead", () => {
  it("sends read receipts for the unread received messages", async () => {
    findAll.mockResolvedValue([
      { messagesWhatsappsId: "WA1", fromMe: false, dataJson: JSON.stringify(raw) },
      { messagesWhatsappsId: null, fromMe: false, dataJson: null }
    ]);
    await SetTicketMessagesAsRead(ticket);
    expect(readMessages).toHaveBeenCalledWith([
      { remoteJid: "140716097450191@lid", id: "WA1", participant: undefined, fromMe: false }
    ]);
    expect(update).toHaveBeenCalledWith({ read: true }, { where: { ticketId: 1, read: false } });
  });

  it("marks messages read in the system even when WhatsApp fails", async () => {
    findAll.mockResolvedValue([{ messagesWhatsappsId: "WA1", fromMe: false, dataJson: JSON.stringify(raw) }]);
    readMessages.mockRejectedValue(new Error("App state key not present!"));
    await SetTicketMessagesAsRead(ticket);
    expect(update).toHaveBeenCalled();
    expect(ticket.update).toHaveBeenCalledWith({ unreadMessages: 0 });
  });

  it("resets the counter new messages are added to", async () => {
    findAll.mockResolvedValue([]);
    await SetTicketMessagesAsRead({ ...ticket, contactId: 7 });
    expect(cacheSet).toHaveBeenCalledWith("contacts:7:3:unreads", "0");
  });

  it("does nothing on WhatsApp when nothing is unread", async () => {
    findAll.mockResolvedValue([]);
    await SetTicketMessagesAsRead(ticket);
    expect(readMessages).not.toHaveBeenCalled();
  });
});
