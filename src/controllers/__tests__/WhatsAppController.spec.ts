const sessionService = { add: jest.fn(async () => true), remove: jest.fn() };
const startBaileys = jest.fn();
const removeWbot = jest.fn();
const emit = jest.fn();
const created: any = { id: 11, companyId: 1 };

jest.mock("../../libs/wbot", () => ({ removeWbot: (...a: any[]) => removeWbot(...a) }));
jest.mock("../../services/WbotServices/StartWhatsAppSession", () => ({ StartWhatsAppSession: (...a: any[]) => startBaileys(...a) }));
jest.mock("../../services/WhatsmeowServices/SessionService", () => ({ __esModule: true, default: sessionService }));
jest.mock("../../services/WhatsappService/CreateWhatsAppService", () => ({
  __esModule: true,
  default: async () => ({ whatsapp: created, oldDefaultWhatsapp: null })
}));
jest.mock("../../services/WhatsappService/DeleteWhatsAppService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/WhatsappService/ShowWhatsAppService", () => ({ __esModule: true, default: async () => created }));
jest.mock("../../services/WhatsappService/ListWhatsAppsService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/WhatsappService/UpdateWhatsAppService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit }) }) }));

/* eslint-disable import/first */
import { store, remove } from "../WhatsAppController";
import DeleteWhatsAppService from "../../services/WhatsappService/DeleteWhatsAppService";
/* eslint-enable import/first */

const res: any = { status: () => ({ json: jest.fn() }) };
const flush = () => new Promise(r => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WHATSAPP_ENGINE;
});

afterAll(() => {
  delete process.env.WHATSAPP_ENGINE;
});

describe("WhatsAppController.store", () => {
  const req: any = { body: { name: "Nova", queueIds: [] }, user: { companyId: 1, profile: "admin" } };

  it("baileys: StartWhatsAppSession como hoje", async () => {
    await store(req, res);
    await flush();
    expect(startBaileys).toHaveBeenCalledWith(created, 1);
    expect(sessionService.add).not.toHaveBeenCalled();
  });

  it("whatsmeow: SessionService.add (consumer + connect), sem Baileys", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    await store(req, res);
    await flush();
    expect(sessionService.add).toHaveBeenCalledWith(created);
    expect(startBaileys).not.toHaveBeenCalled();
  });
});

describe("WhatsAppController.remove", () => {
  const req: any = { params: { whatsappId: "11" }, user: { companyId: 1 } };

  it("baileys: removeWbot como hoje", async () => {
    await remove(req, res);
    expect(DeleteWhatsAppService).toHaveBeenCalledWith("11");
    expect(removeWbot).toHaveBeenCalledWith(11);
    expect(sessionService.remove).not.toHaveBeenCalled();
  });

  it("whatsmeow: SessionService.remove, sem removeWbot", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    await remove(req, res);
    expect(DeleteWhatsAppService).toHaveBeenCalledWith("11");
    expect(sessionService.remove).toHaveBeenCalledWith(11);
    expect(removeWbot).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("company-1-whatsapp", { action: "delete", whatsappId: 11 });
  });
});
