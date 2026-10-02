const findOne = jest.fn();
const create = jest.fn();
const emit = jest.fn();

jest.mock("../../../libs/socket", () => ({ getIO: () => { const io: any = { emit }; io.to = () => io; return io; } }));
jest.mock("../../../models/Contact", () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => findOne(...a), create: (...a: any[]) => create(...a) }
}));
jest.mock("../../../models/ContactCustomField", () => ({}));

// eslint-disable-next-line import/first
import CreateOrUpdateContactService from "../CreateOrUpdateContactService";

const existing = (name: string): any => ({ name, number: "5511999999999", lid: null, whatsappId: 3, update: jest.fn() });

describe("CreateOrUpdateContactService name", () => {
  it("names a contact still named after its number", async () => {
    const contact = existing("5511999999999");
    findOne.mockResolvedValue(contact);
    await CreateOrUpdateContactService({ name: "Maria", number: "5511999999999", isGroup: false, companyId: 1 });
    expect(contact.update).toHaveBeenCalledWith({ name: "Maria" });
  });

  it("keeps a name typed in the platform", async () => {
    const contact = existing("Cliente VIP");
    findOne.mockResolvedValue(contact);
    await CreateOrUpdateContactService({ name: "Maria", number: "5511999999999", isGroup: false, companyId: 1 });
    expect(contact.update).not.toHaveBeenCalledWith({ name: "Maria" });
  });

  it("does not rename to the number itself", async () => {
    const contact = existing("5511999999999");
    findOne.mockResolvedValue(contact);
    await CreateOrUpdateContactService({ name: "5511999999999", number: "5511999999999", isGroup: false, companyId: 1 });
    expect(contact.update).not.toHaveBeenCalledWith({ name: "5511999999999" });
  });
});
