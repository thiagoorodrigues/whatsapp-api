const emit = jest.fn();
const to = jest.fn(() => ({ emit }));

jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to }) }));
jest.mock("../../../channels", () => ({ getTicketChannel: jest.fn(), ticketAddress: jest.fn() }));
jest.mock("../../../models/Contact", () => ({ findOne: jest.fn() }));
jest.mock("../../../models/Ticket", () => ({ findAll: jest.fn() }));

// eslint-disable-next-line import/first
import Contact from "../../../models/Contact";
// eslint-disable-next-line import/first
import Ticket from "../../../models/Ticket";
// eslint-disable-next-line import/first
import { getTicketChannel } from "../../../channels";
// eslint-disable-next-line import/first
import { handlePresenceUpdate, sendAttendantTyping, typingState } from "../ContactTypingService";

describe("contact typing", () => {
  beforeEach(() => jest.clearAllMocks());

  it("only typing and recording count", () => {
    expect(typingState("composing")).toBe("composing");
    expect(typingState("recording")).toBe("recording");
    expect(typingState("paused")).toBeNull();
    expect(typingState("available")).toBeNull();
    expect(typingState(undefined)).toBeNull();
  });

  it("tells the open tickets of the contact on that connection", async () => {
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 7 });
    (Ticket.findAll as jest.Mock).mockResolvedValue([{ id: 42 }]);

    await handlePresenceUpdate(1, 3, { id: "123:4@lid", presences: { "123:4@lid": { lastKnownPresence: "composing" } } });

    expect((Contact.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({ companyId: 1, lid: "123@lid" });
    expect((Ticket.findAll as jest.Mock).mock.calls[0][0].where).toMatchObject({ companyId: 1, contactId: 7, whatsappId: 3 });
    expect(to).toHaveBeenCalledWith("company-1-ticket-42");
    expect(emit).toHaveBeenCalledWith("company-1-typing", { ticketId: 42, state: "composing" });
  });

  it("finds phone-number contacts and ignores groups", async () => {
    (Contact.findOne as jest.Mock).mockResolvedValue(null);
    await handlePresenceUpdate(1, 3, { id: "5531999990000@s.whatsapp.net", presences: {} });
    expect((Contact.findOne as jest.Mock).mock.calls[0][0].where).toMatchObject({ number: "5531999990000" });

    await handlePresenceUpdate(1, 3, { id: "1203@g.us", presences: {} });
    expect(Contact.findOne).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("attendant typing", () => {
  const sendTyping = jest.fn().mockResolvedValue(undefined);
  const ticket = { id: 1, whatsappId: 3, status: "open", contact: { number: "5531" } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (getTicketChannel as jest.Mock).mockResolvedValue({ sendTyping });
  });

  it("maps the panel state to the channel", async () => {
    await sendAttendantTyping(ticket, "composing");
    await sendAttendantTyping(ticket, "recording");
    await sendAttendantTyping(ticket, "paused");
    expect(sendTyping.mock.calls.map(c => c[1])).toEqual([true, "recording", false]);
  });

  it("skips closed tickets and ignores channel errors", async () => {
    await sendAttendantTyping({ ...ticket, status: "closed" }, "composing");
    expect(sendTyping).not.toHaveBeenCalled();
    sendTyping.mockRejectedValueOnce(new Error("Connection Closed"));
    await expect(sendAttendantTyping(ticket, "composing")).resolves.toBeUndefined();
  });
});
