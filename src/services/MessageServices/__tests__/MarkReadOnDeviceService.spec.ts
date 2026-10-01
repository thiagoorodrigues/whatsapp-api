const findAll = jest.fn();
const update = jest.fn();
const count = jest.fn();
const findOne = jest.fn();
const cacheSet = jest.fn();
const emit = jest.fn();

jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: {
    findAll: (...a: any[]) => findAll(...a),
    update: (...a: any[]) => update(...a),
    count: (...a: any[]) => count(...a)
  }
}));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findOne(...a) } }));
jest.mock("../../../libs/cache", () => ({ cacheLayer: { set: (...a: any[]) => cacheSet(...a) } }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ to: () => ({ emit }) }) }) }));

// eslint-disable-next-line import/first
import MarkReadOnDeviceService from "../MarkReadOnDeviceService";

const ticket: any = { id: 5, contactId: 9, status: "open", unreadMessages: 12, update: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  findOne.mockResolvedValue(ticket);
});

describe("MarkReadOnDeviceService", () => {
  it("clears the ticket when everything was read on the phone", async () => {
    const upTo = new Date("2026-10-01T12:03:00Z");
    findAll.mockResolvedValue([
      { ticketId: 5, createdAt: new Date("2026-10-01T12:00:00Z") },
      { ticketId: 5, createdAt: upTo }
    ]);
    count.mockResolvedValue(0);
    await MarkReadOnDeviceService(["A", "B"], 1);
    expect(update.mock.calls[0][1].where.ticketId).toBe(5);
    expect(ticket.update).toHaveBeenCalledWith({ unreadMessages: 0 });
    expect(cacheSet).toHaveBeenCalledWith("contacts:9:unreads", "0");
    expect(emit).toHaveBeenCalledWith("company-1-ticket", { action: "updateUnread", ticketId: 5 });
  });

  it("keeps the messages that arrived after the last one read", async () => {
    findAll.mockResolvedValue([{ ticketId: 5, createdAt: new Date() }]);
    count.mockResolvedValue(2);
    await MarkReadOnDeviceService(["A"], 1);
    expect(ticket.update).toHaveBeenCalledWith({ unreadMessages: 2 });
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores ids the system does not know", async () => {
    findAll.mockResolvedValue([]);
    await MarkReadOnDeviceService(["X"], 1);
    expect(findOne).not.toHaveBeenCalled();
  });
});
