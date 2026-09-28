const send = jest.fn();
const groupParticipants = jest.fn();
const saveSent = jest.fn();

jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ send: (...a: any[]) => send(...a), groupParticipants: (...a: any[]) => groupParticipants(...a) }),
  ticketAddress: (t: any) => ({ number: t.contact.number, isGroup: t.isGroup }),
  messageRef: (m: any) => m
}));
jest.mock("../../MessageServices/SaveSentMessageService", () => ({ __esModule: true, default: (a: any) => saveSent(a) }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../helpers/Mustache", () => ({ __esModule: true, default: (body: string) => body }));

// eslint-disable-next-line import/first
import SendWhatsAppMessage from "../SendWhatsAppMessage";

const group: any = { id: 12, isGroup: true, contact: { number: "120363999" } };

beforeEach(() => {
  send.mockReset().mockResolvedValue({ externalId: "X" });
  groupParticipants.mockReset().mockResolvedValue([{ jid: "1@lid" }, { jid: "5511900000003@s.whatsapp.net" }]);
  saveSent.mockReset();
});

describe("SendWhatsAppMessage mentions", () => {
  it("sends only the mentioned jids that are in the group", async () => {
    await SendWhatsAppMessage({ body: "oi @1", ticket: group, mentions: ["1@lid", "999@lid"] });
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi @1", mentions: ["1@lid"] }, expect.anything());
  });

  it("ignores mentions outside groups and does not look up members", async () => {
    await SendWhatsAppMessage({ body: "oi", ticket: { ...group, isGroup: false }, mentions: ["1@lid"] });
    expect(groupParticipants).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi" }, expect.anything());
  });

  it("sends a plain text when there are no mentions", async () => {
    await SendWhatsAppMessage({ body: "oi", ticket: group });
    expect(groupParticipants).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi" }, expect.anything());
  });

  it("still sends the text when the member lookup fails", async () => {
    groupParticipants.mockRejectedValue(new Error("rate-overlimit"));
    await SendWhatsAppMessage({ body: "oi @1", ticket: group, mentions: ["1@lid"] });
    expect(send).toHaveBeenCalledWith(expect.anything(), { type: "text", text: "oi @1" }, expect.anything());
  });
});
