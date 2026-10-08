const findOne = jest.fn();
const react = jest.fn();
const emit = jest.fn();

jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findOne(...a) } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: {} }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit }) }) }));
jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ react: (...a: any[]) => react(...a) }),
  ticketAddress: () => ({ number: "5511999999999" }),
  messageRef: (m: any) => ({ externalId: m.messagesWhatsappsId })
}));

// eslint-disable-next-line import/first
import SendReactionService from "../SendReactionService";

const message = (extra: any = {}): any => {
  const m: any = {
    id: 7,
    companyId: 1,
    ticketId: 5,
    messagesWhatsappsId: "M1",
    reactions: [{ emoji: "😂", jid: "5511@s.whatsapp.net", fromMe: false, at: 1 }],
    ticket: { contact: {} },
    ...extra
  };
  m.update = jest.fn(async (v: any) => Object.assign(m, v));
  return m;
};

beforeEach(() => jest.clearAllMocks());

describe("SendReactionService", () => {
  it("sends the emoji and stores it as ours, keeping the contact's", async () => {
    const m = message();
    findOne.mockResolvedValue(m);
    await SendReactionService({ messageId: 7, companyId: 1, emoji: "👍" });
    expect(findOne.mock.calls[0][0].where).toEqual({ id: 7, companyId: 1 });
    expect(react).toHaveBeenCalledWith({ number: "5511999999999" }, { externalId: "M1" }, "👍");
    expect(m.reactions.map((r: any) => r.emoji)).toEqual(["😂", "👍"]);
    expect(m.reactions[1]).toEqual(expect.objectContaining({ jid: "me", fromMe: true }));
    expect(emit).toHaveBeenCalledWith("company-1-appMessage", { action: "update", message: m });
  });

  it("an empty emoji removes ours", async () => {
    const m = message({ reactions: [{ emoji: "👍", jid: "me", fromMe: true, at: 1 }] });
    findOne.mockResolvedValue(m);
    await SendReactionService({ messageId: 7, companyId: 1, emoji: "" });
    expect(react).toHaveBeenCalledWith(expect.anything(), expect.anything(), "");
    expect(m.reactions).toBeNull();
  });

  it("refuses internal notes and messages of another company", async () => {
    findOne.mockResolvedValue(message({ isPrivate: true }));
    await expect(SendReactionService({ messageId: 7, companyId: 1, emoji: "👍" })).rejects.toBeTruthy();
    findOne.mockResolvedValue(null);
    await expect(SendReactionService({ messageId: 7, companyId: 2, emoji: "👍" })).rejects.toBeTruthy();
    expect(react).not.toHaveBeenCalled();
  });
});
