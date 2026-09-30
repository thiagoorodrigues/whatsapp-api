const rows: any[] = [];
const emit = jest.fn();
const ticketUpdate = jest.fn();

jest.mock("../../../libs/socket", () => ({
  getIO: () => ({ to: () => ({ to: () => ({ to: () => ({ emit }) }) }) })
}));
jest.mock("../../../models/Ticket", () => ({}));
jest.mock("../../../models/Whatsapp", () => ({}));
jest.mock("../../../models/User", () => ({}));
jest.mock("../ResolveMentionsService", () => ({
  __esModule: true,
  default: async (messages: any[]) =>
    messages.forEach(m => {
      if (`${m.body}`.includes("@5511")) m.mentions = [{ token: "5511", name: "Maria", phone: "5511" }];
    })
}));
jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: {
    findOne: async ({ where }: any) =>
      rows.find(r => r.messagesWhatsappsId === where.messagesWhatsappsId && r.companyId === where.companyId) || null,
    upsert: async (values: any) => {
      const index = rows.findIndex(r => r.id === values.id);
      if (index >= 0) rows[index] = { ...rows[index], ...values };
      else rows.push({ ...values });
    },
    findByPk: async (id: string) => {
      const row = rows.find(r => r.id === id);
      return (
        row && {
          ...row,
          queueId: 1,
          ticket: { queueId: 1, status: "open", contact: {}, lastMessage: row.body, update: ticketUpdate },
          update: jest.fn()
        }
      );
    }
  }
}));

// eslint-disable-next-line import/first
import CreateMessageService from "../CreateMessageService";

const base = { ticketId: 1, body: "Olá", fromMe: true };

beforeEach(() => {
  rows.splice(0);
  emit.mockClear();
  ticketUpdate.mockClear();
});

describe("CreateMessageService", () => {
  it("keeps one row when the same WhatsApp message is saved twice", async () => {
    await CreateMessageService({ companyId: 1, messageData: { ...base, id: "uuid-1", messagesWhatsappsId: "WA1" } });
    const second = await CreateMessageService({
      companyId: 1,
      messageData: { ...base, id: "uuid-2", messagesWhatsappsId: "WA1", ack: 2 }
    });
    expect(rows).toHaveLength(1);
    expect(second.id).toBe("uuid-1");
    expect(rows[0].ack).toBe(2);
  });

  it("does not merge across companies or messages without a WhatsApp id", async () => {
    await CreateMessageService({ companyId: 1, messageData: { ...base, id: "a", messagesWhatsappsId: "WA1" } });
    await CreateMessageService({ companyId: 2, messageData: { ...base, id: "b", messagesWhatsappsId: "WA1" } });
    await CreateMessageService({ companyId: 1, messageData: { ...base, id: "c" } });
    await CreateMessageService({ companyId: 1, messageData: { ...base, id: "d" } });
    expect(rows.map(r => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not change the ticket preview for an internal note, but still emits it", async () => {
    await CreateMessageService({
      companyId: 1,
      messageData: { ...base, id: "note-1", body: "fala com @5511", isPrivate: true, userId: 5 }
    });
    expect(ticketUpdate).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("company-1-appMessage", expect.objectContaining({ action: "create" }));
  });

  it("shows mention names in the ticket preview for a regular message", async () => {
    await CreateMessageService({ companyId: 1, messageData: { ...base, id: "m-1", body: "fala com @5511" } });
    expect(ticketUpdate).toHaveBeenCalledWith({ lastMessage: "fala com @Maria" });
  });
});
