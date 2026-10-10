const findOne = jest.fn();
const create = jest.fn();

jest.mock("../../../models/Ticket", () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => findOne(...a), create: (...a: any[]) => create(...a) }
}));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: async () => ({ id: 2 }) } }));
jest.mock("../../../models/Setting", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: {} }));
const tracking = jest.fn();
jest.mock("../FindOrCreateATicketTrakingService", () => ({ __esModule: true, default: (...a: any[]) => tracking(...a) }));
jest.mock("../ShowTicketService", () => ({ __esModule: true, default: async (id: number) => ({ id }) }));

// eslint-disable-next-line import/first
import FindOrCreateTicketService from "../FindOrCreateTicketService";

const contact: any = { id: 3, isGroup: false };

beforeEach(() => {
  findOne.mockReset();
  create.mockReset().mockImplementation(async (data: any) => ({ id: 9, ...data }));
  tracking.mockReset();
});

describe("FindOrCreateTicketService", () => {
  it("opens a new conversation as pending", async () => {
    findOne.mockResolvedValue(null);
    await FindOrCreateTicketService(contact, 2, 1, 1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", unreadMessages: 1 }));
  });

  it("files a conversation found only in the history as closed, nothing unread", async () => {
    findOne.mockResolvedValue(null);
    await FindOrCreateTicketService(contact, 2, 0, 1, undefined, true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: "closed", unreadMessages: 0 }));
  });

  it("leaves the unread count of an existing ticket alone for history messages", async () => {
    const existing = { id: 5, status: "open", update: jest.fn() };
    findOne.mockResolvedValue(existing);
    await FindOrCreateTicketService(contact, 2, 0, 1, undefined, true);
    expect(existing.update).not.toHaveBeenCalled();
  });

  it("dates a history-only conversation by its message and keeps it out of the reports", async () => {
    findOne.mockResolvedValue(null);
    const at = new Date("2026-09-01T11:56:10Z");
    await FindOrCreateTicketService(contact, 2, 0, 1, undefined, true, at);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: "closed", createdAt: at, updatedAt: at }), { silent: true });
    expect(tracking).not.toHaveBeenCalled();
  });

  it("a live conversation still gets its tracking row", async () => {
    findOne.mockResolvedValue(null);
    await FindOrCreateTicketService(contact, 2, 1, 1);
    expect(tracking).toHaveBeenCalled();
  });
});
