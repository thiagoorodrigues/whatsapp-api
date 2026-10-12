const findSchedule = jest.fn();
const findWhatsapp = jest.fn();
const getDefault = jest.fn();
const findOrCreate = jest.fn();
const sendTicket = jest.fn();

jest.mock("../../../models/Schedule", () => ({ __esModule: true, default: { findByPk: (...a: any[]) => findSchedule(...a) } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findWhatsapp(...a) } }));
jest.mock("../../../helpers/GetDefaultWhatsApp", () => ({ __esModule: true, default: (...a: any[]) => getDefault(...a) }));
jest.mock("../../TicketServices/FindOrCreateTicketService", () => ({ __esModule: true, default: (...a: any[]) => findOrCreate(...a) }));
jest.mock("../../MessageServices/SendTicketMessageService", () => ({ __esModule: true, default: (...a: any[]) => sendTicket(...a) }));
jest.mock("../../../helpers/Mustache", () => ({ __esModule: true, formatForTicket: async (body: string) => `${body}!` }));
jest.mock("../../../config/upload", () => ({ __esModule: true, default: { directory: "/srv/public" } }));

// eslint-disable-next-line import/first
import SendScheduledMessageService from "../SendScheduledMessageService";

const contact = { id: 71, number: "553191147761", lid: "140716097450191@lid" };
const ticket = { id: 51 };

beforeEach(() => {
  jest.clearAllMocks();
  findOrCreate.mockResolvedValue(ticket);
  sendTicket.mockResolvedValue({ id: "m1" });
});

it("sends through the contact's ticket on the chosen connection, so it is saved", async () => {
  findSchedule.mockResolvedValue({ id: 4, companyId: 1, whatsappsId: 3, body: "Teste", contact });
  findWhatsapp.mockResolvedValue({ id: 3 });
  await SendScheduledMessageService(4);
  expect(findWhatsapp).toHaveBeenCalledWith({ where: { id: 3, companyId: 1, status: "CONNECTED" } });
  expect(findOrCreate).toHaveBeenCalledWith(contact, 3, 0, 1);
  expect(sendTicket).toHaveBeenCalledWith(ticket, { type: "text", text: "Teste!" });
});

it("falls back to the default connection and sends the attachment with the text as caption", async () => {
  findSchedule.mockResolvedValue({ id: 5, companyId: 1, whatsappsId: 9, body: "Oi", mediaPath: "1700_foto.png", mediaName: "foto.png", contact });
  findWhatsapp.mockResolvedValue(null);
  getDefault.mockResolvedValue({ id: 3 });
  await SendScheduledMessageService(5);
  expect(getDefault).toHaveBeenCalledWith(1);
  expect(sendTicket).toHaveBeenCalledWith(ticket, expect.objectContaining({ type: "image", path: "/srv/public/1700_foto.png", caption: "Oi!" }));
});

it("fails when the schedule has no contact", async () => {
  findSchedule.mockResolvedValue({ id: 6, companyId: 1, body: "x", contact: null });
  await expect(SendScheduledMessageService(6)).rejects.toThrow("has no contact");
  expect(sendTicket).not.toHaveBeenCalled();
});
