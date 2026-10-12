jest.mock("../../../models/Setting", () => ({ findOne: jest.fn() }));
jest.mock("../../../models/Contact", () => ({ findOne: jest.fn() }));
jest.mock("../../../models/Ticket", () => ({ findOne: jest.fn() }));
jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../MessageServices/SendTicketMessageService", () => ({ __esModule: true, default: jest.fn() }));
const send = jest.fn();
jest.mock("../../../channels", () => ({ getChannel: jest.fn(() => ({ send })) }));

/* eslint-disable import/first */
import Setting from "../../../models/Setting";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import CreateMessageService from "../../MessageServices/CreateMessageService";
import SendTicketMessageService from "../../MessageServices/SendTicketMessageService";
import MissedCallService from "../MissedCallService";
/* eslint-enable import/first */

describe("MissedCallService", () => {
  const ticket = { id: 9, status: "closed", update: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "disabled" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 7 });
    (Ticket.findOne as jest.Mock).mockResolvedValue(ticket);
  });

  it("com chamadas habilitadas não faz nada", async () => {
    (Setting.findOne as jest.Mock).mockResolvedValue({ value: "enabled" });
    await MissedCallService({ whatsappId: 3, companyId: 1, from: "5531@s.whatsapp.net", callId: "c1" });
    expect(SendTicketMessageService).not.toHaveBeenCalled();
    expect(CreateMessageService).not.toHaveBeenCalled();
  });

  it("avisa pelo ticket, registra call_log e reabre o ticket fechado", async () => {
    await MissedCallService({ whatsappId: 3, companyId: 1, from: "123:4@lid", callId: "c1" });

    expect((Contact.findOne as jest.Mock).mock.calls[0][0].where).toEqual({ companyId: 1, lid: "123@lid" });
    expect((Ticket.findOne as jest.Mock).mock.calls[0][0].where).toEqual({ contactId: 7, whatsappId: 3, companyId: 1 });
    expect((SendTicketMessageService as jest.Mock).mock.calls[0][1].text).toContain("Mensagem Automática");
    const { messageData, companyId } = (CreateMessageService as jest.Mock).mock.calls[0][0];
    expect(companyId).toBe(1);
    expect(messageData).toMatchObject({ id: "c1", ticketId: 9, contactId: 7, mediaType: "call_log", fromMe: false, ack: 1, read: true });
    expect(messageData.body).toMatch(/^Chamada de voz\/vídeo perdida às \d+:\d+$/);
    expect(ticket.update).toHaveBeenCalledWith({ status: "pending" });
  });

  it("número de telefone: busca pelo número; sem ticket envia direto e não registra", async () => {
    (Ticket.findOne as jest.Mock).mockResolvedValue(null);
    await MissedCallService({ whatsappId: 3, companyId: 1, from: "5531999990000@s.whatsapp.net", callId: "c1" });

    expect((Contact.findOne as jest.Mock).mock.calls[0][0].where).toEqual({ companyId: 1, number: "5531999990000" });
    expect(send).toHaveBeenCalledWith({ jid: "5531999990000@s.whatsapp.net" }, expect.objectContaining({ type: "text" }));
    expect(CreateMessageService).not.toHaveBeenCalled();
  });

  it("telefone com sufixo de dispositivo: busca só pelos dígitos do usuário", async () => {
    await MissedCallService({ whatsappId: 3, companyId: 1, from: "5531999990000:12@s.whatsapp.net", callId: "c1" });

    expect((Contact.findOne as jest.Mock).mock.calls[0][0].where).toEqual({ companyId: 1, number: "5531999990000" });
  });
});
