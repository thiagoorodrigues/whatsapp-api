const groupParticipants = jest.fn();
const resolveNames = jest.fn();

jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ groupParticipants: (...a: any[]) => groupParticipants(...a) }),
  ticketAddress: (t: any) => ({ number: t.contact.number, isGroup: t.isGroup })
}));
jest.mock("../../MessageServices/ResolveMentionsService", () => ({
  resolveMentionNames: (...a: any[]) => resolveNames(...a)
}));

// eslint-disable-next-line import/first
import ListGroupParticipantsService from "../ListGroupParticipantsService";

const ticket: any = { id: 12, companyId: 1, isGroup: true, contact: { number: "120363999" } };
const view = (token: string, name: string | null, phone: string | null) => ({ token, name, phone });

beforeEach(() => {
  groupParticipants.mockReset();
  resolveNames.mockReset();
});

describe("ListGroupParticipantsService", () => {
  it("refuses a ticket that is not a group", async () => {
    await expect(ListGroupParticipantsService({ ...ticket, isGroup: false })).rejects.toMatchObject({ message: "ERR_TICKET_NOT_GROUP", statusCode: 400 });
  });

  it("names members by LID or by phone, drops the account itself and sorts by name", async () => {
    groupParticipants.mockResolvedValue([
      { jid: "1@lid", lid: "1@lid", phone: "5531900000001", isAdmin: false, isMe: false },
      { jid: "2@lid", lid: "2@lid", isAdmin: true, isMe: false },
      { jid: "5511900000003@s.whatsapp.net", phone: "5511900000003", isAdmin: false, isMe: false },
      { jid: "9@lid", lid: "9@lid", phone: "5511888888888", isAdmin: false, isMe: true }
    ]);
    resolveNames.mockResolvedValue(
      new Map([
        ["1@lid", view("1", null, null)],
        ["5531900000001@s.whatsapp.net", view("5531900000001", "Zé", "5531900000001")],
        ["2@lid", view("2", null, null)],
        ["5511900000003@s.whatsapp.net", view("5511900000003", "Ana", "5511900000003")]
      ])
    );

    const list = await ListGroupParticipantsService(ticket);

    expect(resolveNames).toHaveBeenCalledWith(
      expect.arrayContaining(["1@lid", "5531900000001@s.whatsapp.net", "2@lid", "5511900000003@s.whatsapp.net"]),
      1
    );
    expect(list).toEqual([
      { jid: "5511900000003@s.whatsapp.net", token: "5511900000003", name: "Ana", phone: "5511900000003", isAdmin: false },
      { jid: "1@lid", token: "1", name: "Zé", phone: "5531900000001", isAdmin: false },
      { jid: "2@lid", token: "2", name: null, phone: null, isAdmin: true }
    ]);
  });
});
