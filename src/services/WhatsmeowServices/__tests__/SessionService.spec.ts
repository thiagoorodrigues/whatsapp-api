const client = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  logout: jest.fn(),
  status: jest.fn(),
  setPresence: jest.fn(),
  health: jest.fn()
};
const emit = jest.fn();

jest.mock("../../../channels/whatsmeow/client", () => ({ gatewayClient: () => client }));
jest.mock("../../../channels/whatsmeow/consumer", () => ({
  startConsumer: jest.fn(),
  addConnection: jest.fn(),
  removeConnection: jest.fn(),
  stopConsumer: jest.fn()
}));
jest.mock("../../../channels/whatsmeow/handlers", () => ({
  __esModule: true,
  default: jest.fn(),
  handleEnvelope: jest.fn(),
  forgetConnection: jest.fn()
}));
jest.mock("../../../models/Whatsapp", () => ({ findByPk: jest.fn(), findAll: jest.fn() }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit }) }) }));
jest.mock("../../WhatsappService/FindNumberInUseService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../WhatsappContactServices/SyncSessionContactsService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../libs/systemLog", () => ({ recordLog: jest.fn(), newProtocol: () => "PROTO1" }));
jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import AppError from "../../../errors/AppError";
import Whatsapp from "../../../models/Whatsapp";
import * as consumer from "../../../channels/whatsmeow/consumer";
import { handleEnvelope, forgetConnection } from "../../../channels/whatsmeow/handlers";
import * as state from "../../../channels/whatsmeow/state";
import FindNumberInUseService from "../../WhatsappService/FindNumberInUseService";
import SyncSessionContactsService from "../../WhatsappContactServices/SyncSessionContactsService";
import { recordLog } from "../../../libs/systemLog";
import SessionService from "../SessionService";
/* eslint-enable import/first */

const ME = "5531999990000:12@s.whatsapp.net";

const fakeWhatsapp = (over: any = {}): any => {
  const w: any = { id: 7, companyId: 2, name: "Vendas", status: "OPENING", showOnline: false, qrcode: "", retries: 0, ...over };
  w.update = jest.fn(async (values: any) => Object.assign(w, values));
  return w;
};

const sessionUpdates = () => emit.mock.calls.filter(([ev, p]) => ev === "company-2-whatsappSession" && p.action === "update");

const flush = () => new Promise(resolve => setImmediate(resolve));

let whatsapp: any;

beforeEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
  SessionService.resetForTests();
  state.resetState();
  whatsapp = fakeWhatsapp();
  (Whatsapp.findByPk as jest.Mock).mockImplementation(async (id: number) => (id === whatsapp.id ? whatsapp : null));
  client.connect.mockResolvedValue({ state: "connecting" });
  client.logout.mockResolvedValue({});
  client.setPresence.mockResolvedValue({});
  client.health.mockResolvedValue({ status: "ok", connected: 0, sessions: 0 });
});

afterEach(() => {
  state.stopHealthPoll();
  SessionService.resetForTests();
});

describe("start", () => {
  it("marca OPENING, emite e chama POST /connect sem tocar em session", async () => {
    await SessionService.start(whatsapp);
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "OPENING" });
    expect(client.connect).toHaveBeenCalledWith(7);
    expect(sessionUpdates()).toHaveLength(1);
    expect(sessionUpdates()[0][1].session).toBe(whatsapp);
    whatsapp.update.mock.calls.forEach(([v]: any[]) => expect(v).not.toHaveProperty("session"));
  });

  it("connect que já devolve connected grava CONNECTED (nenhum evento novo vai chegar)", async () => {
    client.connect.mockResolvedValue({ state: "connected", me: ME });
    await SessionService.start(whatsapp);
    expect(whatsapp.status).toBe("CONNECTED");
    expect(whatsapp.number).toBe("5531999990000");
    expect(state.isReady(7)).toBe(true);
  });

  it("gateway fora do ar: DISCONNECTED, emite e não lança", async () => {
    client.connect.mockRejectedValue(new AppError("ERR_GATEWAY_UNAVAILABLE", 503));
    await expect(SessionService.start(whatsapp)).resolves.toBe(false);
    expect(whatsapp.status).toBe("DISCONNECTED");
    expect(sessionUpdates()).toHaveLength(2);
  });
});

describe("onConnection", () => {
  it("qr: grava o texto cru, status qrcode, retries 0 e emite", async () => {
    await SessionService.onConnection(7, { status: "qr", qr: "2@abc" });
    expect(whatsapp.update).toHaveBeenCalledWith({ qrcode: "2@abc", status: "qrcode", retries: 0 });
    expect(sessionUpdates()).toHaveLength(1);
    expect(state.getStatus(7)).toBe("qr");
  });

  it("pair_code: só registra o estado (a tela não usa)", async () => {
    await SessionService.onConnection(7, { status: "pair_code", code: "ABCD-1234" });
    expect(whatsapp.update).not.toHaveBeenCalled();
    expect(state.getStatus(7)).toBe("pair_code");
  });

  it("connected: CONNECTED, número, presença conforme showOnline e contatos da sessão", async () => {
    await SessionService.onConnection(7, { status: "connected", me: ME });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "CONNECTED", qrcode: "", retries: 0, number: "5531999990000" });
    expect(sessionUpdates()).toHaveLength(1);
    expect(state.isReady(7)).toBe(true);
    expect(client.setPresence).toHaveBeenCalledWith(7, "unavailable");
    expect(SyncSessionContactsService).toHaveBeenCalledWith({ whatsappId: 7, companyId: 2, me: { id: ME } });
    // Sem pareamento novo não confere número em uso (igual ao Baileys).
    expect(FindNumberInUseService).not.toHaveBeenCalled();
  });

  it("connected com showOnline liga available", async () => {
    whatsapp.showOnline = true;
    await SessionService.onConnection(7, { status: "connected", me: ME });
    expect(client.setPresence).toHaveBeenCalledWith(7, "available");
  });

  it("falha na presença ou nos contatos não impede o CONNECTED", async () => {
    client.setPresence.mockRejectedValue(new Error("409"));
    (SyncSessionContactsService as jest.Mock).mockRejectedValue(new Error("db"));
    await expect(SessionService.onConnection(7, { status: "connected", me: ME })).resolves.toBeUndefined();
    await flush();
    expect(whatsapp.status).toBe("CONNECTED");
  });

  it("pareamento novo de número já conectado em outra conexão da empresa: logout, DISCONNECTED e numberInUse", async () => {
    (FindNumberInUseService as jest.Mock).mockResolvedValue({ id: 9, name: "Suporte" });
    await SessionService.onConnection(7, { status: "qr", qr: "2@abc" });
    await SessionService.onConnection(7, { status: "connected", me: ME });

    const [w, number, isLive] = (FindNumberInUseService as jest.Mock).mock.calls[0];
    expect(w).toBe(whatsapp);
    expect(number).toBe("5531999990000");
    state.setStatus(9, "connected");
    expect(isLive(9)).toBe(true);
    expect(isLive(10)).toBe(false);

    expect(client.logout).toHaveBeenCalledWith(7);
    expect(whatsapp.update).toHaveBeenLastCalledWith({ status: "DISCONNECTED", qrcode: "" });
    expect(emit).toHaveBeenCalledWith("company-2-whatsappSession", expect.objectContaining({ action: "numberInUse", whatsappId: 7 }));
    expect(state.isReady(7)).toBe(false);

    // O logged_out que o próprio logout gera não reabre QR.
    emit.mockClear();
    await SessionService.onConnection(7, { status: "logged_out" });
    expect(client.connect).not.toHaveBeenCalled();
    expect(whatsapp.status).toBe("DISCONNECTED");
  });

  it("disconnected sem reason: OPENING (o whatsmeow reconecta sozinho)", async () => {
    whatsapp.status = "CONNECTED";
    await SessionService.onConnection(7, { status: "disconnected" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "OPENING" });
    expect(sessionUpdates()).toHaveLength(1);
    expect(state.isReady(7)).toBe(false);
  });

  it("disconnected shutdown: OPENING", async () => {
    await SessionService.onConnection(7, { status: "disconnected", reason: "shutdown" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "OPENING" });
  });

  it("disconnected timeout (QR não lido): DISCONNECTED e qrcode vazio", async () => {
    await SessionService.onConnection(7, { status: "disconnected", reason: "timeout" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED", qrcode: "" });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("disconnected stream_replaced: DISCONNECTED + alerta nos Logs do sistema", async () => {
    await SessionService.onConnection(7, { status: "disconnected", reason: "stream_replaced" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED", qrcode: "" });
    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", code: "WA_STREAM_REPLACED", companyId: 2, protocol: "PROTO1" })
    );
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("disconnected com outro motivo: DISCONNECTED sem nova tentativa", async () => {
    jest.useFakeTimers();
    await SessionService.onConnection(7, { status: "disconnected", reason: "client_outdated" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED", qrcode: "" });
    jest.advanceTimersByTime(120000);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("disconnected connect_failed: DISCONNECTED e nova tentativa com backoff", async () => {
    jest.useFakeTimers();
    await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED", qrcode: "" });
    expect(client.connect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1999);
    expect(client.connect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    jest.useRealTimers();
    await flush();
    await flush();
    expect(client.connect).toHaveBeenCalledWith(7);

    // Segunda falha seguida: espera maior (5 s).
    jest.useFakeTimers();
    client.connect.mockClear();
    await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
    jest.advanceTimersByTime(4999);
    expect(client.connect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    jest.useRealTimers();
    await flush();
    await flush();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it("connected zera as tentativas e cancela a nova tentativa pendente", async () => {
    jest.useFakeTimers();
    await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
    await SessionService.onConnection(7, { status: "connected", me: ME });
    jest.advanceTimersByTime(120000);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("logged_out pelo celular: PENDING, qrcode vazio e POST /connect (novo QR)", async () => {
    jest.useFakeTimers();
    whatsapp.status = "CONNECTED";
    await SessionService.onConnection(7, { status: "logged_out", reason: "logged_out" });
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "PENDING", qrcode: "" });
    expect(sessionUpdates()).toHaveLength(1);
    expect(state.getStatus(7)).toBe("logged_out");
    jest.advanceTimersByTime(2000);
    jest.useRealTimers();
    await flush();
    expect(client.connect).toHaveBeenCalledWith(7);
    whatsapp.update.mock.calls.forEach(([v]: any[]) => expect(v).not.toHaveProperty("session"));
  });

  it("evento connection com mais de 10 minutos não age por si: reconsulta o gateway (sem QR nem reconexão)", async () => {
    jest.useFakeTimers();
    whatsapp.status = "CONNECTED";
    client.status.mockResolvedValue({ state: "connected", me: ME });
    const old = Date.now() - 11 * 60 * 1000;
    await SessionService.onConnection(7, { status: "logged_out" }, old);
    await SessionService.onConnection(7, { status: "qr", qr: "2@old" }, old);
    await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" }, old);
    jest.advanceTimersByTime(120000);
    expect(client.status).toHaveBeenCalledWith(7);
    expect(whatsapp.update).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
    expect(state.isReady(7)).toBe(true);
  });

  it("logged_out atrasado (stream represado) com o gateway sem a sessão: DISCONNECTED, sem novo QR", async () => {
    jest.useFakeTimers();
    whatsapp.status = "CONNECTED";
    state.setStatus(7, "connected");
    client.status.mockRejectedValue(new AppError("ERR_WAPP_NOT_INITIALIZED"));
    await SessionService.onConnection(7, { status: "logged_out" }, Date.now() - 11 * 60 * 1000);
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED", qrcode: "" });
    expect(state.isReady(7)).toBe(false);
    jest.advanceTimersByTime(120000);
    expect(client.connect).not.toHaveBeenCalled();
    expect(whatsapp.status).toBe("DISCONNECTED");
  });

  it("disconnected atrasado com o gateway reconectando: estado deixa de ser connected, banco OPENING", async () => {
    whatsapp.status = "CONNECTED";
    state.setStatus(7, "connected");
    client.status.mockResolvedValue({ state: "connecting" });
    await SessionService.onConnection(7, { status: "disconnected" }, Date.now() - 11 * 60 * 1000);
    expect(state.isReady(7)).toBe(false);
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "OPENING" });
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("evento atrasado com o gateway fora do ar: não muda nada", async () => {
    whatsapp.status = "CONNECTED";
    client.status.mockRejectedValue(new AppError("ERR_GATEWAY_UNAVAILABLE", 503));
    await SessionService.onConnection(7, { status: "logged_out" }, Date.now() - 11 * 60 * 1000);
    expect(whatsapp.update).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("dois logged_out seguidos depois do nosso logout: nenhum reabre QR", async () => {
    jest.useFakeTimers();
    whatsapp.status = "CONNECTED";
    await SessionService.logout(whatsapp);
    await SessionService.onConnection(7, { status: "logged_out" });
    await SessionService.onConnection(7, { status: "logged_out" });
    jest.advanceTimersByTime(10000);
    expect(client.connect).not.toHaveBeenCalled();
    expect(whatsapp.status).toBe("DISCONNECTED");
  });

  it("depois de um qr/connected o logout esperado acaba: logged_out pelo celular volta a pedir QR", async () => {
    jest.useFakeTimers();
    await SessionService.logout(whatsapp);
    await SessionService.onConnection(7, { status: "logged_out" });
    await SessionService.onConnection(7, { status: "connected", me: ME });
    await SessionService.onConnection(7, { status: "logged_out" });
    expect(whatsapp.update).toHaveBeenLastCalledWith({ status: "PENDING", qrcode: "" });
  });

  it("logout esperado expira em 2 minutos", async () => {
    jest.useFakeTimers();
    await SessionService.logout(whatsapp);
    jest.setSystemTime(Date.now() + 2 * 60 * 1000 + 1);
    await SessionService.onConnection(7, { status: "logged_out" });
    expect(whatsapp.update).toHaveBeenLastCalledWith({ status: "PENDING", qrcode: "" });
  });

  it("connect_failed com o connect também falhando: espera cresce uma vez por tentativa (2 s, 5 s, 15 s)", async () => {
    jest.useFakeTimers();
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    const spy = jest.spyOn(global, "setTimeout").mockImplementation(((fn: any, ms?: number) => {
      delays.push(Number(ms));
      return realSetTimeout(fn, ms);
    }) as any);
    // O gateway devolve erro no connect e também publica connect_failed.
    client.connect.mockRejectedValue(new AppError("ERR_GATEWAY_ERROR", 502));
    const fail = () => SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
    const fire = async () => {
      jest.advanceTimersToNextTimer();
      for (let i = 0; i < 10; i += 1) await Promise.resolve(); // eslint-disable-line no-await-in-loop
    };
    await fail();
    await fire(); // 1ª nova tentativa falha: o caminho do timer reagenda
    await fail(); // ...e o evento da mesma falha não conta de novo
    await fire();
    await fail();
    spy.mockRestore();
    expect(delays).toEqual([2000, 5000, 15000]);
    expect(client.connect).toHaveBeenCalledTimes(2);
  });

  it("connect_failed com o evento chegando enquanto a nova tentativa ainda roda: conta uma vez", async () => {
    jest.useFakeTimers();
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    const spy = jest.spyOn(global, "setTimeout").mockImplementation(((fn: any, ms?: number) => {
      delays.push(Number(ms));
      return realSetTimeout(fn, ms);
    }) as any);
    client.connect.mockImplementation(async () => {
      // O evento da falha é processado antes de o connect responder.
      await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
      throw new AppError("ERR_GATEWAY_ERROR", 502);
    });
    await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
    jest.advanceTimersToNextTimer();
    for (let i = 0; i < 20; i += 1) await Promise.resolve(); // eslint-disable-line no-await-in-loop
    spy.mockRestore();
    expect(delays).toEqual([2000, 5000]);
  });

  it("conexão que não existe mais: ignora", async () => {
    await expect(SessionService.onConnection(99, { status: "connected", me: ME })).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("restart (Novo QR)", () => {
  it("sem sessão nem pareamento no gateway (404): segue para o start", async () => {
    client.logout.mockRejectedValue(new AppError("ERR_WAPP_NOT_INITIALIZED"));
    await expect(SessionService.restart(whatsapp)).resolves.toBe(true);
    expect(client.connect).toHaveBeenCalledWith(7);
  });

  it("logout e start; o logged_out que vem depois não mexe no status", async () => {
    await SessionService.restart(whatsapp);
    expect(client.logout).toHaveBeenCalledWith(7);
    expect(client.connect).toHaveBeenCalledWith(7);
    expect(whatsapp.status).toBe("OPENING");
    whatsapp.update.mockClear();
    await SessionService.onConnection(7, { status: "logged_out" });
    expect(whatsapp.update).not.toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
});

describe("logout (Desconectar)", () => {
  it("POST /logout, DISCONNECTED, qrcode vazio, emite; logged_out seguinte não reabre QR", async () => {
    jest.useFakeTimers();
    whatsapp.status = "CONNECTED";
    state.setStatus(7, "connected");
    await SessionService.logout(whatsapp);
    expect(client.logout).toHaveBeenCalledWith(7);
    expect(whatsapp.update).toHaveBeenCalledWith({ status: "DISCONNECTED", qrcode: "" });
    expect(sessionUpdates()).toHaveLength(1);
    expect(state.isReady(7)).toBe(false);
    await SessionService.onConnection(7, { status: "logged_out" });
    jest.advanceTimersByTime(10000);
    expect(client.connect).not.toHaveBeenCalled();
    expect(whatsapp.status).toBe("DISCONNECTED");
  });

  it("sem sessão no gateway (404) ainda marca DISCONNECTED", async () => {
    client.logout.mockRejectedValue(new AppError("ERR_WAPP_NOT_INITIALIZED"));
    await SessionService.logout(whatsapp);
    expect(whatsapp.status).toBe("DISCONNECTED");
  });

  it("gateway fora do ar: lança e não muda o status", async () => {
    whatsapp.status = "CONNECTED";
    client.logout.mockRejectedValue(new AppError("ERR_GATEWAY_UNAVAILABLE", 503));
    await expect(SessionService.logout(whatsapp)).rejects.toThrow("ERR_GATEWAY_UNAVAILABLE");
    expect(whatsapp.status).toBe("CONNECTED");
  });
});

describe("add / remove", () => {
  it("add: consumer passa a ler o stream antes do connect", async () => {
    const order: string[] = [];
    (consumer.addConnection as jest.Mock).mockImplementation(async () => order.push("add"));
    client.connect.mockImplementation(async () => {
      order.push("connect");
      return { state: "qr" };
    });
    await SessionService.add(whatsapp);
    expect(order).toEqual(["add", "connect"]);
  });

  it("remove: logout, consumer para de ler e handlers esquecem a conexão", async () => {
    jest.useFakeTimers();
    await SessionService.onConnection(7, { status: "disconnected", reason: "connect_failed" });
    await SessionService.remove(7);
    expect(client.logout).toHaveBeenCalledWith(7);
    expect(consumer.removeConnection).toHaveBeenCalledWith(7);
    expect(forgetConnection).toHaveBeenCalledWith(7);
    jest.advanceTimersByTime(120000);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it("remove não lança se o gateway falhar", async () => {
    client.logout.mockRejectedValue(new AppError("ERR_GATEWAY_UNAVAILABLE", 503));
    await expect(SessionService.remove(7)).resolves.toBeUndefined();
    expect(consumer.removeConnection).toHaveBeenCalledWith(7);
    expect(forgetConnection).toHaveBeenCalledWith(7);
  });
});

describe("reconcileOnBoot (decisão 2)", () => {
  const conns: Record<number, any> = {};
  const make = (id: number, status: string) => {
    conns[id] = fakeWhatsapp({ id, status, qrcode: status === "qrcode" ? "2@old" : "" });
    return conns[id];
  };

  beforeEach(() => {
    Object.keys(conns).forEach(k => delete conns[Number(k)]);
    (Whatsapp.findByPk as jest.Mock).mockImplementation(async (id: number) => conns[id] || null);
  });

  it("consumer antes dos connect; conecta só ativas pareadas; demais DISCONNECTED sem QR", async () => {
    const list = [
      make(1, "CONNECTED"), // gateway: connecting (pareada) -> connect
      make(2, "OPENING"), // gateway: 404 -> DISCONNECTED
      make(3, "qrcode"), // gateway: qr (QR em andamento no gateway) -> fica
      make(4, "DISCONNECTED"), // gateway: 404 -> fica DISCONNECTED, sem connect
      make(5, "CONNECTED"), // gateway: connected -> CONNECTED + número
      make(6, "PENDING"), // gateway: logged_out -> DISCONNECTED
      make(8, "qrcode") // gateway: 404 -> DISCONNECTED
    ];
    (Whatsapp.findAll as jest.Mock).mockResolvedValue(list);
    const order: string[] = [];
    (consumer.startConsumer as jest.Mock).mockImplementation(async () => order.push("consumer"));
    client.status.mockImplementation(async (id: number) => {
      order.push(`status:${id}`);
      if (id === 1) return { state: "connecting" };
      if (id === 3) return { state: "qr" };
      if (id === 5) return { state: "connected", me: ME };
      if (id === 6) return { state: "logged_out" };
      throw new AppError("ERR_WAPP_NOT_INITIALIZED");
    });
    client.connect.mockImplementation(async (id: number) => {
      order.push(`connect:${id}`);
      return { state: "connecting" };
    });

    await SessionService.reconcileOnBoot();

    // Nunca lê a coluna session.
    expect((Whatsapp.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ attributes: { exclude: ["session"] } });
    expect(order[0]).toBe("consumer");
    const [ids, deps] = (consumer.startConsumer as jest.Mock).mock.calls[0];
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 8]);

    // O handle do consumer pluga onConnection nos handlers.
    await deps.handle({ type: "connection", connectionId: 1, ts: 1, data: {} });
    const handlerDeps = (handleEnvelope as jest.Mock).mock.calls[0][1];
    expect(handlerDeps.onConnection).toBe(SessionService.onConnection);

    expect(client.connect.mock.calls.map(c => c[0])).toEqual([1]);
    expect(conns[1].status).toBe("OPENING");
    expect(conns[2].status).toBe("DISCONNECTED");
    expect(conns[3].status).toBe("qrcode");
    expect(conns[4].update).not.toHaveBeenCalled();
    expect(conns[5].status).toBe("CONNECTED");
    expect(conns[5].number).toBe("5531999990000");
    expect(state.isReady(5)).toBe(true);
    expect(conns[6].status).toBe("DISCONNECTED");
    expect(conns[8]).toMatchObject({ status: "DISCONNECTED", qrcode: "" });
  });

  it("gateway fora do ar no boot: conexões ativas ficam OPENING (os eventos corrigem na volta)", async () => {
    const list = [make(1, "CONNECTED"), make(4, "DISCONNECTED")];
    (Whatsapp.findAll as jest.Mock).mockResolvedValue(list);
    client.status.mockRejectedValue(new AppError("ERR_GATEWAY_UNAVAILABLE", 503));
    await SessionService.reconcileOnBoot();
    expect(client.connect).not.toHaveBeenCalled();
    expect(conns[1].status).toBe("OPENING");
    expect(conns[4].update).not.toHaveBeenCalled();
  });

  it("reconcile por empresa (StartAllWhatsAppsSessions) não reinicia o consumer", async () => {
    (Whatsapp.findAll as jest.Mock).mockResolvedValue([make(1, "CONNECTED")]);
    client.status.mockResolvedValue({ state: "connecting" });
    await SessionService.reconcileCompany(2);
    expect((Whatsapp.findAll as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { companyId: 2 }, attributes: { exclude: ["session"] } });
    expect(consumer.startConsumer).not.toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalledWith(1);
  });
});

describe("shutdown", () => {
  it("para o consumer e o health poll", async () => {
    (Whatsapp.findAll as jest.Mock).mockResolvedValue([]);
    await SessionService.reconcileOnBoot();
    const stopSpy = jest.spyOn(state, "stopHealthPoll");
    await SessionService.shutdown();
    expect(consumer.stopConsumer).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });
});

describe("volta do gateway (health)", () => {
  it("reconfirma as conexões conectadas no gateway e grava CONNECTED onde o banco não está", async () => {
    const a = fakeWhatsapp({ id: 1, status: "OPENING" });
    const b = fakeWhatsapp({ id: 2, status: "CONNECTED" });
    const c = fakeWhatsapp({ id: 3, status: "DISCONNECTED" });
    const byId: any = { 1: a, 2: b, 3: c };
    (Whatsapp.findAll as jest.Mock).mockResolvedValue([a, b, c]);
    (Whatsapp.findByPk as jest.Mock).mockImplementation(async (id: number) => byId[id] || null);
    client.status.mockImplementation(async (id: number) => {
      if (id === 3) throw new AppError("ERR_WAPP_NOT_INITIALIZED");
      return { state: "connected", me: ME };
    });

    await SessionService.recoverAfterHealth();

    expect(state.getStatus(1)).toBe("connected");
    expect(state.getStatus(2)).toBe("connected");
    expect(a.status).toBe("CONNECTED");
    // Já estava CONNECTED no banco: só o registro de estado muda.
    expect(b.update).not.toHaveBeenCalled();
    expect(c.update).not.toHaveBeenCalled();
    expect(state.getStatus(3)).not.toBe("connected");
  });

  it("reconcileOnBoot liga o health com o recoverAfterHealth", async () => {
    (Whatsapp.findAll as jest.Mock).mockResolvedValue([]);
    const spy = jest.spyOn(state, "startHealthPoll").mockImplementation(() => undefined);
    await SessionService.reconcileOnBoot();
    expect(spy).toHaveBeenCalledWith(client, expect.any(Number), SessionService.recoverAfterHealth);
    spy.mockRestore();
  });
});
