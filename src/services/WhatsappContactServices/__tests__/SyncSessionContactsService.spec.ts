const upsert = jest.fn();
const findContacts = jest.fn();

jest.mock("../UpsertWhatsappContactsService", () => ({ __esModule: true, default: (a: any) => upsert(a) }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findContacts(...a) } }));

// eslint-disable-next-line import/first
import SyncSessionContactsService from "../SyncSessionContactsService";

beforeEach(() => {
  upsert.mockReset().mockResolvedValue(0);
  findContacts.mockReset().mockResolvedValue([]);
});

describe("SyncSessionContactsService", () => {
  it("saves the connected account itself with its LID and profile name", async () => {
    await SyncSessionContactsService({
      whatsappId: 3,
      companyId: 1,
      me: { id: "553191673107:5@s.whatsapp.net", lid: "71752461897873:5@lid", name: "Gaby" },
      lidMapping: {}
    });
    expect(upsert).toHaveBeenCalledWith({
      whatsappId: 3,
      companyId: 1,
      contacts: [{ id: "553191673107@s.whatsapp.net", lid: "71752461897873@lid", notify: "Gaby" }]
    });
  });

  it("turns the session LID mappings into phone contacts, skipping reverse entries", async () => {
    await SyncSessionContactsService({
      whatsappId: 3,
      companyId: 1,
      lidMapping: { "5511999999999": "140716097450191", "140716097450191_reverse": "5511999999999", bad: 12 }
    });
    expect(upsert).toHaveBeenCalledWith({
      whatsappId: 3,
      companyId: 1,
      contacts: [{ id: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid" }]
    });
  });

  it("fills the LID of platform contacts that do not have one", async () => {
    const update = jest.fn();
    findContacts.mockResolvedValue([{ number: "5511999999999", lid: null, update }]);
    await SyncSessionContactsService({ whatsappId: 3, companyId: 1, lidMapping: { "5511999999999": "140716097450191" } });
    expect(findContacts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 1 }) }));
    expect(update).toHaveBeenCalledWith({ lid: "140716097450191@lid" });
  });

  it("does nothing without the account or mappings", async () => {
    await SyncSessionContactsService({ whatsappId: 3, companyId: 1, lidMapping: undefined });
    expect(upsert).not.toHaveBeenCalled();
    expect(findContacts).not.toHaveBeenCalled();
  });
});
