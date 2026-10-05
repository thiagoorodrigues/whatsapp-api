const groupInfo = jest.fn();
const resolveNames = jest.fn();
const findContacts = jest.fn();

jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ groupInfo: (...a: any[]) => groupInfo(...a) }),
  ticketAddress: (t: any) => ({ number: t.contact.number, isGroup: t.isGroup })
}));
jest.mock("../../MessageServices/ResolveMentionsService", () => ({
  resolveMentionNames: (...a: any[]) => resolveNames(...a)
}));
jest.mock("../../../models/Contact", () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => findContacts(...a) }
}));

// eslint-disable-next-line import/first
import ShowGroupInfoService from "../ShowGroupInfoService";

const ticket: any = { id: 12, companyId: 1, isGroup: true, contact: { number: "120363999" } };
const view = (token: string, name: string | null, phone: string | null) => ({ token, name, phone });

beforeEach(() => {
  groupInfo.mockReset();
  resolveNames.mockReset();
  findContacts.mockReset();
});

describe("ShowGroupInfoService", () => {
  it("refuses a ticket that is not a group", async () => {
    await expect(ShowGroupInfoService({ ...ticket, isGroup: false })).rejects.toMatchObject({ message: "ERR_TICKET_NOT_GROUP", statusCode: 400 });
  });

  it("keeps the account itself, puts it first and admins next, and links platform contacts", async () => {
    groupInfo.mockResolvedValue({
      subject: "AUDO x South",
      description: "Regras",
      createdAt: null,
      participants: [
        { jid: "1@lid", lid: "1@lid", phone: "5531900000001", isAdmin: false, isMe: false },
        { jid: "2@lid", lid: "2@lid", isAdmin: true, isMe: false },
        { jid: "9@lid", lid: "9@lid", phone: "5511888888888", isAdmin: false, isMe: true }
      ]
    });
    resolveNames.mockResolvedValue(
      new Map([
        ["5531900000001@s.whatsapp.net", view("5531900000001", "Zé", "5531900000001")],
        ["5511888888888@s.whatsapp.net", view("5511888888888", "Empresa", "5511888888888")]
      ])
    );
    findContacts.mockResolvedValue([
      { id: 40, number: "5531900000001", lid: null, profilePicUrl: "http://pic/ze" },
      { id: 41, number: "x", lid: "2@lid", profilePicUrl: "" }
    ]);

    const info = await ShowGroupInfoService(ticket);

    expect(info.subject).toBe("AUDO x South");
    expect(info.description).toBe("Regras");
    expect(info.size).toBe(3);
    expect(info.participants.map(p => [p.jid, p.isMe, p.isAdmin, p.contactId, p.profilePicUrl])).toEqual([
      ["9@lid", true, false, null, null],
      ["2@lid", false, true, 41, null],
      ["1@lid", false, false, 40, "http://pic/ze"]
    ]);
  });
});
