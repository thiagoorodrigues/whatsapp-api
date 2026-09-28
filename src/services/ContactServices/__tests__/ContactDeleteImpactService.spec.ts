const contactCount = jest.fn();
const ticketFind = jest.fn();
const messageCount = jest.fn();
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { count: (a: any) => contactCount(a) } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findAll: (a: any) => ticketFind(a) } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { count: (a: any) => messageCount(a) } }));

// eslint-disable-next-line import/first
import ContactDeleteImpactService from "../ContactDeleteImpactService";

describe("ContactDeleteImpactService", () => {
  it("counts the tickets and messages of the company's contacts", async () => {
    contactCount.mockResolvedValue(2);
    ticketFind.mockResolvedValue([{ id: 10 }, { id: 11 }, { id: 12 }]);
    messageCount.mockResolvedValue(57);
    expect(await ContactDeleteImpactService([3, "4" as any, 0], 1)).toEqual({ contacts: 2, tickets: 3, messages: 57 });
    expect(ticketFind).toHaveBeenCalledWith(expect.objectContaining({ where: { contactId: [3, 4], companyId: 1 } }));
    expect(messageCount).toHaveBeenCalledWith({ where: { ticketId: [10, 11, 12], companyId: 1 } });
  });

  it("skips queries when there is nothing to delete", async () => {
    contactCount.mockClear();
    expect(await ContactDeleteImpactService([], 1)).toEqual({ contacts: 0, tickets: 0, messages: 0 });
    expect(contactCount).not.toHaveBeenCalled();
  });
});
