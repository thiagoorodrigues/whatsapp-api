jest.mock("../../../models/Contact", () => ({ update: jest.fn() }));
jest.mock("../UpsertWhatsappContactsService", () => ({ __esModule: true, default: jest.fn() }));

// eslint-disable-next-line import/first
import Contact from "../../../models/Contact";
// eslint-disable-next-line import/first
import UpsertWhatsappContactsService from "../UpsertWhatsappContactsService";
// eslint-disable-next-line import/first
import ApplyLidMappingService from "../ApplyLidMappingService";

describe("ApplyLidMappingService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("grava o LID no contato pelo número e guarda o par", async () => {
    await ApplyLidMappingService({ whatsappId: 3, companyId: 1, lid: "123:4@lid", pn: "5531999990000:2@s.whatsapp.net" });

    expect(Contact.update).toHaveBeenCalledWith({ lid: "123@lid" }, { where: { number: "5531999990000", companyId: 1 } });
    expect(UpsertWhatsappContactsService).toHaveBeenCalledWith({
      whatsappId: 3,
      companyId: 1,
      contacts: [{ id: "5531999990000@s.whatsapp.net", lid: "123@lid" }]
    });
  });

  it("ignora par incompleto", async () => {
    await ApplyLidMappingService({ whatsappId: 3, companyId: 1, lid: "", pn: "5531@s.whatsapp.net" });
    await ApplyLidMappingService({ whatsappId: 3, companyId: 1, lid: "1@lid", pn: "" });
    expect(Contact.update).not.toHaveBeenCalled();
    expect(UpsertWhatsappContactsService).not.toHaveBeenCalled();
  });

  it("não propaga erro do banco", async () => {
    (Contact.update as jest.Mock).mockRejectedValue(new Error("db"));
    await expect(
      ApplyLidMappingService({ whatsappId: 3, companyId: 1, lid: "1@lid", pn: "5531@s.whatsapp.net" })
    ).resolves.toBeUndefined();
  });
});
