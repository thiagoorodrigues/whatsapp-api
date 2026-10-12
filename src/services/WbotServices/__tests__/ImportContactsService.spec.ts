const findAllSynced = jest.fn();
const findContact = jest.fn();
const createContact = jest.fn();

const engine = { whatsmeow: false };
const syncContacts = jest.fn();
const upsert = jest.fn();

jest.mock("../../../channels", () => ({ getDefaultChannel: async () => ({ connectionId: 3 }) }));
jest.mock("../../../config/whatsappEngine", () => ({ isWhatsmeow: () => engine.whatsmeow }));
jest.mock("../../../channels/whatsmeow/client", () => ({ gatewayClient: () => ({ syncContacts }) }));
jest.mock("../../../channels/whatsmeow/handlers", () => ({
  toSyncedContacts: (cs: any[]) => (cs || []).map(c => ({ id: c.jid, name: c.name }))
}));
jest.mock("../../WhatsappContactServices/UpsertWhatsappContactsService", () => ({ __esModule: true, default: (a: any) => upsert(a) }));
jest.mock("../../../models/WhatsappContact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAllSynced(...a) } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findContact(...a) } }));
jest.mock("../../ContactServices/CreateContactService", () => ({ __esModule: true, default: (a: any) => createContact(a) }));

// eslint-disable-next-line import/first
import ImportContactsService from "../ImportContactsService";

beforeEach(() => {
  engine.whatsmeow = false;
  syncContacts.mockReset();
  upsert.mockReset();
  findAllSynced.mockReset();
  findContact.mockReset().mockResolvedValue(null);
  createContact.mockReset();
});

describe("ImportContactsService", () => {
  it("creates platform contacts from the phone numbers WhatsApp sent", async () => {
    findAllSynced.mockResolvedValue([
      { number: "5511999999999", name: "Maria Agenda", notify: "Mari", verifiedName: null },
      { number: "5521988887777", name: null, notify: "João", verifiedName: null }
    ]);

    await ImportContactsService(1);

    expect(findAllSynced).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ whatsappId: 3 }) }));
    expect(createContact).toHaveBeenCalledWith({ number: "5511999999999", name: "Maria Agenda", companyId: 1 });
    expect(createContact).toHaveBeenCalledWith({ number: "5521988887777", name: "João", companyId: 1 });
  });

  it("renames an existing contact only when its name is the number", async () => {
    const save = jest.fn();
    const numbered: any = { name: "5511999999999", number: "5511999999999", save };
    const renamed: any = { name: "Cliente VIP", number: "5521988887777", save: jest.fn() };
    findAllSynced.mockResolvedValue([
      { number: "5511999999999", name: "Maria Agenda" },
      { number: "5521988887777", name: "João" }
    ]);
    findContact.mockImplementation(async ({ where }: any) => (where.number === "5511999999999" ? numbered : renamed));

    await ImportContactsService(1);

    expect(numbered.name).toBe("Maria Agenda");
    expect(save).toHaveBeenCalled();
    expect(renamed.name).toBe("Cliente VIP");
    expect(renamed.save).not.toHaveBeenCalled();
  });

  it("takes the name from the LID entry of the same person when the phone entry has none", async () => {
    findAllSynced.mockResolvedValue([
      { jid: "5585920048774@s.whatsapp.net", lid: "163475682771010@lid", number: "5585920048774", name: null, notify: null, verifiedName: null },
      { jid: "163475682771010@lid", lid: "163475682771010@lid", number: null, name: "Ricardo Nutrir Emporio", notify: null, verifiedName: null }
    ]);

    await ImportContactsService(1);

    expect(createContact).toHaveBeenCalledTimes(1);
    expect(createContact).toHaveBeenCalledWith({ number: "5585920048774", name: "Ricardo Nutrir Emporio", companyId: 1 });
  });

  it("renames an existing numbered contact with the LID entry name", async () => {
    const numbered: any = { name: "5585920048774", number: "5585920048774", save: jest.fn() };
    findContact.mockResolvedValue(numbered);
    findAllSynced.mockResolvedValue([
      { jid: "5585920048774@s.whatsapp.net", lid: "163475682771010@lid", number: "5585920048774", name: null },
      { jid: "163475682771010@lid", lid: null, number: null, notify: "Ricardo" }
    ]);

    await ImportContactsService(1);

    expect(numbered.name).toBe("Ricardo");
    expect(numbered.save).toHaveBeenCalled();
  });

  it("does not create contacts known only by LID", async () => {
    findAllSynced.mockResolvedValue([{ jid: "999@lid", lid: "999@lid", number: null, name: "Só LID" }]);
    await ImportContactsService(1);
    expect(createContact).not.toHaveBeenCalled();
  });

  it("with whatsmeow, refreshes the phone agenda from the gateway before importing", async () => {
    engine.whatsmeow = true;
    syncContacts.mockResolvedValue({ contacts: [{ jid: "5511999999999@s.whatsapp.net", name: "Maria Agenda" }] });
    findAllSynced.mockResolvedValue([]);

    await ImportContactsService(1);

    expect(syncContacts).toHaveBeenCalledWith(3);
    expect(upsert).toHaveBeenCalledWith({
      whatsappId: 3,
      companyId: 1,
      contacts: [{ id: "5511999999999@s.whatsapp.net", name: "Maria Agenda" }]
    });
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(findAllSynced.mock.invocationCallOrder[0]);
  });

  it("with whatsmeow, still imports what is saved when the gateway fails", async () => {
    engine.whatsmeow = true;
    syncContacts.mockRejectedValue(new Error("not_connected"));
    findAllSynced.mockResolvedValue([{ number: "5511999999999", name: "Maria Agenda" }]);

    await ImportContactsService(1);

    expect(upsert).not.toHaveBeenCalled();
    expect(createContact).toHaveBeenCalledWith({ number: "5511999999999", name: "Maria Agenda", companyId: 1 });
  });

  it("with Baileys, does not call the gateway", async () => {
    findAllSynced.mockResolvedValue([]);
    await ImportContactsService(1);
    expect(syncContacts).not.toHaveBeenCalled();
  });
});
