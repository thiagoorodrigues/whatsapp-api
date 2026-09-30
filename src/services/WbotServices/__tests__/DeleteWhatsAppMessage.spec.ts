const channel = { deleteMessage: jest.fn() };
let stored: any = null;

jest.mock("../../../models/Ticket", () => ({}));
jest.mock("../../../helpers/GetWbotMessage", () => jest.fn());
jest.mock("../../../channels", () => ({
  getTicketChannel: jest.fn(async () => channel),
  messageRef: jest.fn(),
  ticketAddress: jest.fn()
}));
jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: { findByPk: async () => stored }
}));

// eslint-disable-next-line import/first
import DeleteWhatsAppMessage from "../DeleteWhatsAppMessage";

describe("DeleteWhatsAppMessage", () => {
  it("refuses an internal note without touching WhatsApp", async () => {
    stored = { id: "note-1", isPrivate: true, ticket: {} };
    await expect(DeleteWhatsAppMessage("note-1")).rejects.toThrow("ERR_INTERNAL_NOTE_ACTION");
    expect(channel.deleteMessage).not.toHaveBeenCalled();
  });
});
