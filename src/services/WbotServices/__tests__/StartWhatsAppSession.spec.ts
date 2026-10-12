const initWASocket = jest.fn();
const sessionService = { start: jest.fn(), reconcileCompany: jest.fn(), reconcileOnBoot: jest.fn() };
const listWhatsApps = jest.fn();
const emit = jest.fn();

jest.mock("../../../libs/wbot", () => ({ initWASocket: (...a: any[]) => initWASocket(...a) }));
jest.mock("../wbotMessageListener", () => ({ wbotMessageListener: jest.fn() }));
jest.mock("../wbotMonitor", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../models/BaileysKey", () => ({ readKeysOfType: jest.fn() }));
jest.mock("../../WhatsappContactServices/SyncSessionContactsService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../WhatsappService/ListWhatsAppsService", () => ({ __esModule: true, default: (...a: any[]) => listWhatsApps(...a) }));
jest.mock("../../WhatsmeowServices/SessionService", () => ({ __esModule: true, default: sessionService }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit }) }) }));
jest.mock("../../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

/* eslint-disable import/first */
import { StartWhatsAppSession } from "../StartWhatsAppSession";
import { StartAllWhatsAppsSessions, StartWhatsAppSessionsOnBoot } from "../StartAllWhatsAppsSessions";
/* eslint-enable import/first */

const whatsapp: any = { id: 4, companyId: 1, update: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WHATSAPP_ENGINE;
});

afterAll(() => {
  delete process.env.WHATSAPP_ENGINE;
});

describe("StartWhatsAppSession", () => {
  it("baileys: OPENING e initWASocket, como hoje", async () => {
    initWASocket.mockResolvedValue({ user: { id: "x" }, ev: { on: jest.fn() } });
    await StartWhatsAppSession(whatsapp, 1);
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "OPENING" });
    expect(initWASocket).toHaveBeenCalledWith(whatsapp);
    expect(sessionService.start).not.toHaveBeenCalled();
  });

  it("whatsmeow: SessionService.start e nunca initWASocket", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    await StartWhatsAppSession(whatsapp, 1);
    expect(sessionService.start).toHaveBeenCalledWith(whatsapp);
    expect(initWASocket).not.toHaveBeenCalled();
    expect(whatsapp.update).not.toHaveBeenCalled();
  });
});

describe("StartAllWhatsAppsSessions", () => {
  it("baileys: sobe todas as conexões da empresa", async () => {
    initWASocket.mockResolvedValue({ user: { id: "x" }, ev: { on: jest.fn() } });
    listWhatsApps.mockResolvedValue([whatsapp, { ...whatsapp, id: 5, update: jest.fn() }]);
    await StartAllWhatsAppsSessions(1);
    await new Promise(r => setImmediate(r));
    expect(initWASocket).toHaveBeenCalledTimes(2);
    expect(sessionService.reconcileCompany).not.toHaveBeenCalled();
  });

  it("whatsmeow: reconciliação da empresa, sem initWASocket", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    await StartAllWhatsAppsSessions(1);
    expect(sessionService.reconcileCompany).toHaveBeenCalledWith(1);
    expect(listWhatsApps).not.toHaveBeenCalled();
    expect(initWASocket).not.toHaveBeenCalled();
  });
});

describe("StartWhatsAppSessionsOnBoot", () => {
  it("baileys: StartAllWhatsAppsSessions por empresa", async () => {
    initWASocket.mockResolvedValue({ user: { id: "x" }, ev: { on: jest.fn() } });
    listWhatsApps.mockResolvedValue([]);
    await StartWhatsAppSessionsOnBoot([1, 2]);
    expect(listWhatsApps.mock.calls.map(c => c[0].companyId)).toEqual([1, 2]);
    expect(sessionService.reconcileOnBoot).not.toHaveBeenCalled();
  });

  it("whatsmeow: uma reconciliação de boot (consumer + health), sem Baileys", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    await StartWhatsAppSessionsOnBoot([1, 2]);
    expect(sessionService.reconcileOnBoot).toHaveBeenCalledTimes(1);
    expect(listWhatsApps).not.toHaveBeenCalled();
    expect(initWASocket).not.toHaveBeenCalled();
  });

  it("whatsmeow: falha na reconciliação não derruba a subida", async () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    sessionService.reconcileOnBoot.mockRejectedValueOnce(new Error("redis"));
    await expect(StartWhatsAppSessionsOnBoot([1])).resolves.toBeUndefined();
  });
});
