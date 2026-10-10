const createOrUpdate = jest.fn(async (data: any) => data);
const findOne = jest.fn();

jest.mock("../../../channels", () => ({ getChannel: () => ({ profilePictureUrl: async () => "https://pic" }) }));
jest.mock("../../ContactServices/CreateOrUpdateContactService", () => ({ __esModule: true, default: (d: any) => createOrUpdate(d) }));
jest.mock("../../../models/WhatsappContact", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findOne(...a) } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import VerifyContactService from "../VerifyContactService";

beforeEach(() => {
  createOrUpdate.mockClear();
  findOne.mockReset().mockResolvedValue(null);
});

const base = { connectionId: 4, companyId: 3 };

describe("VerifyContactService", () => {
  it("keeps the name the message brought", async () => {
    await VerifyContactService({ ...base, jid: "5531999990000@s.whatsapp.net", name: "Ana" });
    expect(createOrUpdate.mock.calls[0][0].name).toBe("Ana");
    expect(findOne).not.toHaveBeenCalled();
  });

  it("without a name, uses the synced address book: saved name first", async () => {
    findOne.mockResolvedValue({ name: "Ricardo Nutrir Emporio", verifiedName: "Nutrir", notify: "Rick" });
    await VerifyContactService({ ...base, jid: "251096773722233@lid" });
    expect(createOrUpdate.mock.calls[0][0].name).toBe("Ricardo Nutrir Emporio");
    const where = findOne.mock.calls[0][0].where;
    expect(where.whatsappId).toBe(4);
    expect(where.companyId).toBe(3);
  });

  it("falls back to the verified business name, then the WhatsApp name", async () => {
    findOne.mockResolvedValue({ name: "", verifiedName: "Loja X", notify: "x" });
    await VerifyContactService({ ...base, jid: "5531999990000@s.whatsapp.net" });
    expect(createOrUpdate.mock.calls[0][0].name).toBe("Loja X");
    findOne.mockResolvedValue({ name: null, verifiedName: null, notify: "Zé" });
    await VerifyContactService({ ...base, jid: "5531999990000@s.whatsapp.net" });
    expect(createOrUpdate.mock.calls[1][0].name).toBe("Zé");
  });

  it("a name that is only the number counts as no name", async () => {
    findOne.mockResolvedValue({ name: "Betania" });
    await VerifyContactService({ ...base, jid: "5531999990000@s.whatsapp.net", name: "5531999990000" });
    expect(createOrUpdate.mock.calls[0][0].name).toBe("Betania");
  });

  it("not in the address book: keeps the number", async () => {
    await VerifyContactService({ ...base, jid: "5531999990000@s.whatsapp.net" });
    expect(createOrUpdate.mock.calls[0][0].name).toBe("5531999990000");
  });

  it("groups do not look in the address book", async () => {
    await VerifyContactService({ ...base, jid: "1203630@g.us" });
    expect(findOne).not.toHaveBeenCalled();
  });
});
