const whatsapp: any = { id: 3, update: jest.fn() };
delete process.env.WHATSAPP_ENGINE;
const start = jest.fn();
const clearKeys = jest.fn();

jest.mock("../../services/WhatsappService/ShowWhatsAppService", () => ({ __esModule: true, default: async () => whatsapp }));
jest.mock("../../services/WbotServices/StartWhatsAppSession", () => ({ StartWhatsAppSession: (...a: any[]) => start(...a) }));
jest.mock("../../models/BaileysKey", () => ({ clearBaileysKeys: (...a: any[]) => clearKeys(...a) }));
const getWbot = jest.fn();
const sessionService = { start: jest.fn(), restart: jest.fn(), logout: jest.fn() };
jest.mock("../../libs/wbot", () => ({ getWbot: (...a: any[]) => getWbot(...a) }));
jest.mock("../../services/WhatsmeowServices/SessionService", () => ({ __esModule: true, default: sessionService }));

// eslint-disable-next-line import/first
import WhatsAppSessionController from "../WhatsAppSessionController";
// eslint-disable-next-line import/first
import { requestContext } from "../../libs/requestContext";

describe("WhatsAppSessionController.update (Novo QR Code)", () => {
  it("resets only the session, keeping queues and the history import", async () => {
    const res: any = { status: () => ({ json: jest.fn() }) };
    await WhatsAppSessionController.update({ params: { whatsappId: "3" }, user: { companyId: 1 } } as any, res);
    expect(whatsapp.update).toHaveBeenCalledWith({ session: "" });
    expect(clearKeys).toHaveBeenCalledWith(3);
    expect(start).toHaveBeenCalledWith(whatsapp, 1);
  });

  it("starts the session outside the request context", async () => {
    const stores: any[] = [];
    start.mockImplementationOnce(() => stores.push(requestContext.getStore()));
    const res: any = { status: () => ({ json: jest.fn() }) };
    const req: any = { params: { whatsappId: "3" }, user: { companyId: 1 } };
    await requestContext.run({ req, res }, () => WhatsAppSessionController.store(req, res));
    expect(stores).toEqual([undefined]);
  });
});

describe("motor whatsmeow", () => {
  const res: any = { status: () => ({ json: jest.fn() }) };
  const req: any = { params: { whatsappId: "3" }, user: { companyId: 1 } };

  beforeEach(() => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    jest.clearAllMocks();
    whatsapp.session = "";
  });

  afterEach(() => {
    delete process.env.WHATSAPP_ENGINE;
  });

  const noBaileys = () => {
    expect(start).not.toHaveBeenCalled();
    expect(clearKeys).not.toHaveBeenCalled();
    expect(getWbot).not.toHaveBeenCalled();
    whatsapp.update.mock.calls.forEach(([v]: any[]) => expect(v).not.toHaveProperty("session"));
  };

  it("store (Tentar de novo) chama SessionService.start fora do contexto da requisição", async () => {
    const stores: any[] = [];
    sessionService.start.mockImplementationOnce(() => stores.push(requestContext.getStore()));
    await requestContext.run({ req, res }, () => WhatsAppSessionController.store(req, res));
    expect(sessionService.start).toHaveBeenCalledWith(whatsapp);
    expect(stores).toEqual([undefined]);
    noBaileys();
  });

  it("update (Novo QR) chama SessionService.restart sem tocar em session nem BaileysKeys", async () => {
    await WhatsAppSessionController.update(req, res);
    expect(sessionService.restart).toHaveBeenCalledWith(whatsapp);
    noBaileys();
  });

  it("remove (Desconectar) chama SessionService.logout mesmo com session vazia", async () => {
    await WhatsAppSessionController.remove(req, res);
    expect(sessionService.logout).toHaveBeenCalledWith(whatsapp);
    noBaileys();
  });
});
