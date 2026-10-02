const update = jest.fn();

jest.mock("../ShowWhatsAppService", () => ({ __esModule: true, default: async () => ({ id: 3, update }) }));
jest.mock("../AssociateWhatsappQueue", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../helpers/changePresenceOnline", () => ({ __esModule: true, ApplyPresence: jest.fn() }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: async () => null } }));

// eslint-disable-next-line import/first
import UpdateWhatsAppService from "../UpdateWhatsAppService";

describe("UpdateWhatsAppService", () => {
  it("never writes the status: the form may hold one older than the session", async () => {
    await UpdateWhatsAppService({
      whatsappId: "3",
      companyId: 1,
      whatsappData: { name: "Thiago Rodrigues", status: "PENDING", session: "x", queueIds: [] }
    });
    const written = update.mock.calls[0][0];
    expect(written.name).toBe("Thiago Rodrigues");
    expect(written).not.toHaveProperty("status");
    expect(written).not.toHaveProperty("session");
  });
});
