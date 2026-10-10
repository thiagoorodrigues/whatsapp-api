const findAllSynced = jest.fn();
const findContact = jest.fn();
const createContact = jest.fn();

jest.mock("../../../channels", () => ({ getDefaultChannel: async () => ({ connectionId: 3 }) }));
jest.mock("../../../models/WhatsappContact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAllSynced(...a) } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findContact(...a) } }));
jest.mock("../../ContactServices/CreateContactService", () => ({ __esModule: true, default: (a: any) => createContact(a) }));

// eslint-disable-next-line import/first
import ImportContactsService from "../ImportContactsService";

beforeEach(() => {
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
});
