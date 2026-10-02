const whatsapp: any = { id: 3, update: jest.fn() };
const start = jest.fn();
const clearKeys = jest.fn();

jest.mock("../../services/WhatsappService/ShowWhatsAppService", () => ({ __esModule: true, default: async () => whatsapp }));
jest.mock("../../services/WbotServices/StartWhatsAppSession", () => ({ StartWhatsAppSession: (...a: any[]) => start(...a) }));
jest.mock("../../models/BaileysKey", () => ({ clearBaileysKeys: (...a: any[]) => clearKeys(...a) }));
jest.mock("../../libs/wbot", () => ({ getWbot: jest.fn() }));

// eslint-disable-next-line import/first
import WhatsAppSessionController from "../WhatsAppSessionController";

describe("WhatsAppSessionController.update (Novo QR Code)", () => {
  it("resets only the session, keeping queues and the history import", async () => {
    const res: any = { status: () => ({ json: jest.fn() }) };
    await WhatsAppSessionController.update({ params: { whatsappId: "3" }, user: { companyId: 1 } } as any, res);
    expect(whatsapp.update).toHaveBeenCalledWith({ session: "" });
    expect(clearKeys).toHaveBeenCalledWith(3);
    expect(start).toHaveBeenCalledWith(whatsapp, 1);
  });
});
