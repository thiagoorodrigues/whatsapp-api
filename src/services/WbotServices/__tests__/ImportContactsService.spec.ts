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
});
