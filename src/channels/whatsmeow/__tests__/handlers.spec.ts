jest.mock("../../../config/whatsappEngine", () => ({
  gatewayConfig: () => ({ url: "x", token: "t", mediaRoot: "/nonexistent" })
}));
jest.mock("../../../models/Whatsapp", () => ({ findByPk: jest.fn() }));
jest.mock("../../../models/Message", () => ({ count: jest.fn(), findAll: jest.fn() }));
jest.mock("../../../services/InboundServices/ProcessInboundMessage", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/InboundServices/CampaignReplyService", () => ({ verifyRecentCampaign: jest.fn() }));
jest.mock("../../../services/MessageServices/UpdateMessageAckService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/MessageServices/MarkReadOnDeviceService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/MessageServices/ReactToMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/WhatsappContactServices/ApplyLidMappingService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/WhatsappContactServices/UpsertWhatsappContactsService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../../services/TicketServices/MissedCallService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/TicketServices/ContactTypingService", () => ({ handleContactTyping: jest.fn() }));
jest.mock("../../../services/WhatsappService/ShowWhatsAppService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../services/WhatsappService/FinishHistoryImportService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../libs/historyImportProgress", () => ({ publishImportProgress: jest.fn() }));
jest.mock("../../../libs/whatsappCache", () => ({ forgetGroup: jest.fn() }));
jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import Whatsapp from "../../../models/Whatsapp";
import Message from "../../../models/Message";
import ProcessInboundMessage from "../../../services/InboundServices/ProcessInboundMessage";
import { verifyRecentCampaign } from "../../../services/InboundServices/CampaignReplyService";
import UpdateMessageAckService from "../../../services/MessageServices/UpdateMessageAckService";
import MarkReadOnDeviceService from "../../../services/MessageServices/MarkReadOnDeviceService";
import ReactToMessageService from "../../../services/MessageServices/ReactToMessageService";
import ApplyLidMappingService from "../../../services/WhatsappContactServices/ApplyLidMappingService";
import UpsertWhatsappContactsService from "../../../services/WhatsappContactServices/UpsertWhatsappContactsService";
import MissedCallService from "../../../services/TicketServices/MissedCallService";
import { handleContactTyping } from "../../../services/TicketServices/ContactTypingService";
import ShowWhatsAppService from "../../../services/WhatsappService/ShowWhatsAppService";
import FinishHistoryImportService from "../../../services/WhatsappService/FinishHistoryImportService";
import { publishImportProgress } from "../../../libs/historyImportProgress";
import { forgetGroup } from "../../../libs/whatsappCache";
import { markSentByPlatform } from "../../sentByPlatform";
import * as state from "../state";
import { handleEnvelope, historyIdle, resetHandlers, HandlerDeps } from "../handlers";
/* eslint-enable import/first */

const CONN = 7;
const COMPANY = 3;
const PHONE = "5511999990000@s.whatsapp.net";
const LID = "1234567890123@lid";
const GROUP = "120363000000000000@g.us";

const env = (type: string, data: any, connectionId = CONN) => ({ type, connectionId, ts: 1760000000000, data });

const messageData = (over: Record<string, any> = {}) => ({
  id: "ABC123",
  fromMe: false,
  history: false,
  timestamp: 1760000000000,
  chat: { jid: PHONE, isGroup: false },
  sender: { jid: PHONE, name: "Maria" },
  kind: "text",
  channelType: "conversation",
  text: "oi",
  hasMedia: false,
  forwarded: false,
  mentions: [],
  raw: { key: { id: over.id || "ABC123", remoteJid: PHONE, fromMe: false }, message: { conversation: "oi" } },
  ...over
});

const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
  inbound: { client: { downloadMedia: jest.fn() } as any, lookupLid: jest.fn().mockResolvedValue(undefined) },
  history: { pauseMs: 0, idleMs: 5 },
  ...over
});

describe("handlers do gateway", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetHandlers();
    state.resetState();
    (Whatsapp.findByPk as jest.Mock).mockResolvedValue({ id: CONN, companyId: COMPANY });
    (Message.count as jest.Mock).mockResolvedValue(0);
    (Message.findAll as jest.Mock).mockResolvedValue([]);
  });

  describe("conexão", () => {
    it("busca a empresa uma vez por conexão", async () => {
      await handleEnvelope(env("group_update", { jid: GROUP }), deps());
      await handleEnvelope(env("group_update", { jid: GROUP }), deps());
      expect(Whatsapp.findByPk).toHaveBeenCalledTimes(1);
      expect(Whatsapp.findByPk).toHaveBeenCalledWith(CONN, expect.anything());
    });

    it("conexão desconhecida: só registra e sai (sem lançar)", async () => {
      (Whatsapp.findByPk as jest.Mock).mockResolvedValue(null);
      await expect(handleEnvelope(env("message", messageData()), deps())).resolves.toBeUndefined();
      expect(Message.count).not.toHaveBeenCalled();
      expect(ProcessInboundMessage).not.toHaveBeenCalled();
    });

    it("erro de banco ao buscar a conexão lança (o consumer tenta de novo)", async () => {
      (Whatsapp.findByPk as jest.Mock).mockRejectedValue(new Error("db down"));
      await expect(handleEnvelope(env("message", messageData()), deps())).rejects.toThrow("db down");
    });

    it("tipo desconhecido é ignorado", async () => {
      await expect(handleEnvelope(env("whatever", {}), deps())).resolves.toBeUndefined();
    });
  });

  describe("message", () => {
    it("grava e verifica campanha", async () => {
      await handleEnvelope(env("message", messageData()), deps());
      expect(Message.count).toHaveBeenCalledWith({ where: { messagesWhatsappsId: "ABC123", whatsappId: CONN } });
      expect(ProcessInboundMessage).toHaveBeenCalledTimes(1);
      const inbound = (ProcessInboundMessage as jest.Mock).mock.calls[0][0];
      expect(inbound).toMatchObject({ connectionId: CONN, companyId: COMPANY, externalId: "ABC123", history: false });
      expect(verifyRecentCampaign).toHaveBeenCalledWith(inbound);
    });

    it("a mesma mensagem entregue duas vezes é gravada uma vez", async () => {
      (Message.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await handleEnvelope(env("message", messageData()), deps());
      await handleEnvelope(env("message", messageData()), deps());
      expect(ProcessInboundMessage).toHaveBeenCalledTimes(1);
      expect(verifyRecentCampaign).toHaveBeenCalledTimes(1);
    });

    it("eco do que a plataforma enviou é ignorado", async () => {
      markSentByPlatform(CONN, "SENT1");
      await handleEnvelope(env("message", messageData({ id: "SENT1", fromMe: true })), deps());
      expect(Message.count).not.toHaveBeenCalled();
      expect(ProcessInboundMessage).not.toHaveBeenCalled();
    });

    it("mensagem fromMe digitada no celular segue o fluxo", async () => {
      await handleEnvelope(env("message", messageData({ id: "PHONE1", fromMe: true })), deps());
      expect(ProcessInboundMessage).toHaveBeenCalledTimes(1);
    });

    it("status do WhatsApp (toInbound null) não grava", async () => {
      await handleEnvelope(env("message", messageData({ chat: { jid: "status@broadcast", isGroup: false } })), deps());
      expect(ProcessInboundMessage).not.toHaveBeenCalled();
    });

    it("falha ao gravar lança (retry); falha na campanha só registra", async () => {
      (ProcessInboundMessage as jest.Mock).mockRejectedValueOnce(new Error("db"));
      await expect(handleEnvelope(env("message", messageData()), deps())).rejects.toThrow("db");

      (verifyRecentCampaign as jest.Mock).mockRejectedValueOnce(new Error("redis"));
      await expect(handleEnvelope(env("message", messageData({ id: "X2" })), deps())).resolves.toBeUndefined();
    });
  });

  describe("receipt", () => {
    it("delivered/read/played viram 3/4/5 por id", async () => {
      await handleEnvelope(env("receipt", { ids: ["A", "B"], chat: PHONE, sender: PHONE, isGroup: false, status: "delivered" }), deps());
      await handleEnvelope(env("receipt", { ids: ["A"], chat: PHONE, sender: PHONE, isGroup: false, status: "read" }), deps());
      await handleEnvelope(env("receipt", { ids: ["A"], chat: PHONE, sender: PHONE, isGroup: false, status: "played" }), deps());
      expect((UpdateMessageAckService as jest.Mock).mock.calls).toEqual([
        ["A", 3, CONN],
        ["B", 3, CONN],
        ["A", 4, CONN],
        ["A", 5, CONN]
      ]);
      expect(MarkReadOnDeviceService).not.toHaveBeenCalled();
    });

    it("chat em LID ainda atualiza pelo id", async () => {
      await handleEnvelope(env("receipt", { ids: ["L1"], chat: LID, sender: LID, isGroup: false, status: "read" }), deps());
      expect(UpdateMessageAckService).toHaveBeenCalledWith("L1", 4, CONN);
    });

    it("read_self/played_self marcam como lidas no aparelho", async () => {
      await handleEnvelope(env("receipt", { ids: ["R1", "R2"], chat: PHONE, sender: PHONE, isGroup: false, status: "read_self" }), deps());
      await handleEnvelope(env("receipt", { ids: ["R3"], chat: GROUP, sender: PHONE, isGroup: true, status: "played_self" }), deps());
      expect((MarkReadOnDeviceService as jest.Mock).mock.calls).toEqual([
        [["R1", "R2"], COMPANY, CONN],
        [["R3"], COMPANY, CONN]
      ]);
      expect(UpdateMessageAckService).not.toHaveBeenCalled();
    });

    it("status desconhecido é ignorado", async () => {
      await handleEnvelope(env("receipt", { ids: ["A"], chat: PHONE, sender: PHONE, isGroup: false, status: "sender" }), deps());
      expect(UpdateMessageAckService).not.toHaveBeenCalled();
      expect(MarkReadOnDeviceService).not.toHaveBeenCalled();
    });

    it("grupo: nossas mensagens sobem o ack; leitura de mensagem recebida = lida por nós", async () => {
      (Message.findAll as jest.Mock).mockResolvedValue([
        { messagesWhatsappsId: "OURS", fromMe: true },
        { messagesWhatsappsId: "THEIRS", fromMe: false }
      ]);
      await handleEnvelope(
        env("receipt", { ids: ["OURS", "THEIRS", "UNSAVED"], chat: GROUP, sender: PHONE, isGroup: true, status: "read" }),
        deps()
      );
      expect((Message.findAll as jest.Mock).mock.calls[0][0].where.whatsappId).toBe(CONN);
      expect(MarkReadOnDeviceService).toHaveBeenCalledWith(["THEIRS"], COMPANY, CONN);
      // Ainda não gravada: só pode ser nossa (membros só confirmam as nossas).
      expect((UpdateMessageAckService as jest.Mock).mock.calls).toEqual([
        ["OURS", 4, CONN],
        ["UNSAVED", 4, CONN]
      ]);
    });

    it("grupo: entregue para mensagem recebida não faz nada", async () => {
      (Message.findAll as jest.Mock).mockResolvedValue([{ messagesWhatsappsId: "THEIRS", fromMe: false }]);
      await handleEnvelope(env("receipt", { ids: ["THEIRS"], chat: GROUP, sender: PHONE, isGroup: true, status: "delivered" }), deps());
      expect(MarkReadOnDeviceService).not.toHaveBeenCalled();
      expect(UpdateMessageAckService).not.toHaveBeenCalled();
    });
  });

  it("reaction: jid cru de quem reagiu, \"me\" quando fomos nós", async () => {
    await handleEnvelope(env("reaction", { id: "M1", chat: GROUP, sender: LID, fromMe: false, emoji: "👍", at: 123 }), deps());
    await handleEnvelope(env("reaction", { id: "M1", chat: PHONE, sender: "me", fromMe: true, emoji: "", at: 0 }), deps());
    const calls = (ReactToMessageService as jest.Mock).mock.calls.map(c => c[0]);
    expect(calls[0]).toEqual({ companyId: COMPANY, whatsappId: CONN, externalId: "M1", jid: LID, fromMe: false, emoji: "👍", at: 123 });
    expect(calls[1]).toMatchObject({ jid: "me", fromMe: true, emoji: "" });
    expect(calls[1].at).toBeGreaterThan(0);
  });

  it("message_update: só confirma (decisão 5)", async () => {
    await expect(handleEnvelope(env("message_update", { id: "M1", chat: PHONE, revoked: true }), deps())).resolves.toBeUndefined();
    expect(Message.count).not.toHaveBeenCalled();
  });

  it("presence: chat e estado para o digitando; erro não lança", async () => {
    await handleEnvelope(env("presence", { chat: LID, sender: LID, state: "composing" }), deps());
    expect(handleContactTyping).toHaveBeenCalledWith({ companyId: COMPANY, whatsappId: CONN, chatJid: LID, state: "composing" });
    (handleContactTyping as jest.Mock).mockRejectedValueOnce(new Error("db"));
    await expect(handleEnvelope(env("presence", { chat: LID, sender: LID, state: "paused" }), deps())).resolves.toBeUndefined();
  });

  it("lid_mapping", async () => {
    await handleEnvelope(env("lid_mapping", { lid: LID, pn: PHONE }), deps());
    expect(ApplyLidMappingService).toHaveBeenCalledWith({ whatsappId: CONN, companyId: COMPANY, lid: LID, pn: PHONE });
  });

  it("contacts: SyncedContact com id = jid", async () => {
    await handleEnvelope(env("contacts", { contacts: [{ jid: PHONE, lid: LID, name: "Maria", notify: "Mari" }, { jid: LID }] }), deps());
    expect(UpsertWhatsappContactsService).toHaveBeenCalledWith({
      whatsappId: CONN,
      companyId: COMPANY,
      contacts: [
        { id: PHONE, lid: LID, name: "Maria", notify: "Mari" },
        { id: LID, lid: undefined, name: undefined, notify: undefined }
      ]
    });
    await handleEnvelope(env("contacts", { contacts: [] }), deps());
    expect(UpsertWhatsappContactsService).toHaveBeenCalledTimes(1);
  });

  it("group_update: esquece o grupo em cache", async () => {
    await handleEnvelope(env("group_update", { jid: GROUP }), deps());
    expect(forgetGroup).toHaveBeenCalledWith(CONN, GROUP);
  });

  describe("call", () => {
    it("terminate com from em LID chama MissedCallService", async () => {
      await handleEnvelope(env("call", { event: "terminate", callId: "C1", from: "123:4@lid", isVideo: false, isGroup: false, ts: 1 }), deps());
      expect(MissedCallService).toHaveBeenCalledWith({ whatsappId: CONN, companyId: COMPANY, from: "123:4@lid", callId: "C1" });
    });

    it("terminate com telefone com sufixo de dispositivo passa o from cru", async () => {
      await handleEnvelope(
        env("call", { event: "terminate", callId: "C2", from: "5511999990000:12@s.whatsapp.net", isVideo: true, isGroup: false, ts: 1 }),
        deps()
      );
      expect(MissedCallService).toHaveBeenCalledWith(expect.objectContaining({ from: "5511999990000:12@s.whatsapp.net", callId: "C2" }));
    });

    it("offer e chamada de grupo são ignorados; erro do serviço não lança", async () => {
      await handleEnvelope(env("call", { event: "offer", callId: "C3", from: PHONE, isGroup: false }), deps());
      await handleEnvelope(env("call", { event: "terminate", callId: "C4", from: PHONE, isGroup: true }), deps());
      expect(MissedCallService).not.toHaveBeenCalled();
      (MissedCallService as jest.Mock).mockRejectedValueOnce(new Error("send failed"));
      await expect(
        handleEnvelope(env("call", { event: "terminate", callId: "C5", from: PHONE, isGroup: false }), deps())
      ).resolves.toBeUndefined();
    });
  });

  describe("connection", () => {
    it("padrão: atualiza o registro de estado", async () => {
      await handleEnvelope(env("connection", { status: "connected", me: PHONE }), deps());
      expect(state.getStatus(CONN)).toBe("connected");
      await handleEnvelope(env("connection", { status: "logged_out" }), deps());
      expect(state.getStatus(CONN)).toBe("logged_out");
    });

    it("delega para onConnection quando informado", async () => {
      const onConnection = jest.fn();
      await handleEnvelope(env("connection", { status: "qr", qr: "2@abc" }), deps({ onConnection }));
      expect(onConnection).toHaveBeenCalledWith(CONN, { status: "qr", qr: "2@abc" });
      expect(state.getStatus(CONN)).toBe("unknown");
    });
  });

  describe("history", () => {
    beforeEach(() => {
      (ShowWhatsAppService as jest.Mock).mockResolvedValue({ importMessages: true, initialDate: "2025-01-01", finalDate: null });
      (FinishHistoryImportService as jest.Mock).mockResolvedValue(undefined);
    });

    it("lote com final: contatos primeiro, mensagens com history=true, receivedAll e fim", async () => {
      const order: string[] = [];
      (UpsertWhatsappContactsService as jest.Mock).mockImplementation(async () => order.push("contacts"));
      (ProcessInboundMessage as jest.Mock).mockImplementation(async (m: any) => order.push(m.externalId));
      (Message.count as jest.Mock).mockImplementation(async ({ where }: any) => (where.messagesWhatsappsId === "OLD" ? 1 : 0));

      await handleEnvelope(
        env("history", {
          messages: [
            messageData({ id: "H1", history: true }),
            messageData({ id: "OLD", history: true }),
            messageData({ id: "S1", history: true, chat: { jid: "status@broadcast", isGroup: false } })
          ],
          contacts: [{ jid: PHONE, name: "Maria" }],
          progress: 40,
          final: true
        }),
        deps()
      );
      await historyIdle(CONN);
      await new Promise(r => setTimeout(r, 20));

      expect(order).toEqual(["contacts", "H1"]);
      expect((ProcessInboundMessage as jest.Mock).mock.calls[0][0]).toMatchObject({ externalId: "H1", history: true, companyId: COMPANY });
      expect(verifyRecentCampaign).not.toHaveBeenCalled();
      expect(ShowWhatsAppService).toHaveBeenCalledWith(CONN, COMPANY);
      const reports = (publishImportProgress as jest.Mock).mock.calls.map(c => c[2]);
      expect(reports.some((p: any) => p.receivedPercent === 100)).toBe(true);
      const last = reports[reports.length - 1];
      expect(last).toMatchObject({ status: "done", saved: 1, existing: 1, total: 2 });
      expect(FinishHistoryImportService).toHaveBeenCalledWith(CONN, COMPANY);
    });

    it("um importador por conexão, reaproveitado entre lotes", async () => {
      await handleEnvelope(env("history", { messages: [messageData({ id: "A1" })], contacts: [], progress: 10, final: false }), deps());
      await handleEnvelope(env("history", { messages: [messageData({ id: "A2" })], contacts: [], progress: 20, final: false }), deps());
      await historyIdle(CONN);
      expect((ProcessInboundMessage as jest.Mock).mock.calls.map(c => c[0].externalId)).toEqual(["A1", "A2"]);
      expect(UpsertWhatsappContactsService).not.toHaveBeenCalled();
    });
  });
});
