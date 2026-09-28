const findAll = jest.fn();
const bulkCreate = jest.fn();

jest.mock("../../../models/WhatsappContact", () => ({
  __esModule: true,
  default: { findAll: (...a: any[]) => findAll(...a), bulkCreate: (...a: any[]) => bulkCreate(...a) }
}));

// eslint-disable-next-line import/first
import UpsertWhatsappContactsService from "../UpsertWhatsappContactsService";

beforeEach(() => {
  findAll.mockReset().mockResolvedValue([]);
  bulkCreate.mockReset().mockResolvedValue([]);
});

describe("UpsertWhatsappContactsService", () => {
  it("creates phone and LID contacts and skips groups and broadcasts", async () => {
    const saved = await UpsertWhatsappContactsService({
      whatsappId: 3,
      companyId: 1,
      contacts: [
        { id: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid", name: "Maria Agenda", notify: "Mari" },
        { id: "222@lid", phoneNumber: "5521988887777@s.whatsapp.net", notify: "João" },
        { id: "120363430882999421@g.us", name: "Grupo" },
        { id: "status@broadcast" }
      ]
    });

    expect(saved).toBe(2);
    expect(bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({ whatsappId: 3, companyId: 1, jid: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid", number: "5511999999999", name: "Maria Agenda", notify: "Mari" }),
        expect.objectContaining({ jid: "222@lid", lid: "222@lid", number: "5521988887777", notify: "João" })
      ],
      { ignoreDuplicates: true }
    );
  });

  it("keeps saved fields when an update brings only some of them", async () => {
    const update = jest.fn();
    findAll.mockResolvedValue([
      { jid: "5511999999999@s.whatsapp.net", lid: "140716097450191@lid", number: "5511999999999", name: "Maria Agenda", notify: "Mari", verifiedName: null, update }
    ]);

    await UpsertWhatsappContactsService({
      whatsappId: 3,
      companyId: 1,
      contacts: [{ id: "5511999999999@s.whatsapp.net", notify: "Maria S." }]
    });

    expect(update).toHaveBeenCalledWith({ lid: "140716097450191@lid", number: "5511999999999", name: "Maria Agenda", notify: "Maria S.", verifiedName: null });
    expect(bulkCreate).not.toHaveBeenCalled();
  });

  it("does not write when nothing changed", async () => {
    const update = jest.fn();
    findAll.mockResolvedValue([{ jid: "1@lid", lid: "1@lid", number: null, name: null, notify: "Ana", verifiedName: null, update }]);
    await UpsertWhatsappContactsService({ whatsappId: 3, companyId: 1, contacts: [{ id: "1@lid", notify: "Ana" }] });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 0 for an empty list", async () => {
    expect(await UpsertWhatsappContactsService({ whatsappId: 3, companyId: 1, contacts: [] })).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });
});
