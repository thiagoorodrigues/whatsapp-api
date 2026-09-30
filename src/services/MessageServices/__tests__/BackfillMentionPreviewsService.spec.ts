const findTickets = jest.fn();
const findLast = jest.fn();
const resolve = jest.fn();

jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findTickets(...a) } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findLast(...a) } }));
jest.mock("../ResolveMentionsService", () => ({ __esModule: true, default: (...a: any[]) => resolve(...a) }));

// eslint-disable-next-line import/first
import BackfillMentionPreviewsService from "../BackfillMentionPreviewsService";

beforeEach(() => {
  findTickets.mockReset();
  findLast.mockReset();
  resolve.mockReset().mockImplementation(async (messages: any[]) => {
    messages.forEach(m => { m.mentions = [{ token: "1", name: "Maria", phone: null }]; });
  });
});

describe("BackfillMentionPreviewsService", () => {
  it("rewrites previews that are the text of the ticket's last message", async () => {
    const update = jest.fn();
    findTickets.mockResolvedValue([{ id: 8, companyId: 1, lastMessage: "oi @1", update }]);
    findLast.mockResolvedValue({ body: "oi @1", dataJson: "{}" });

    expect(await BackfillMentionPreviewsService()).toBe(1);
    expect(findLast).toHaveBeenCalledWith(expect.objectContaining({ where: { ticketId: 8, isPrivate: false } }));
    expect(update).toHaveBeenCalledWith({ lastMessage: "oi @Maria" });
  });

  it("skips tickets whose preview is not the last message or that have no message", async () => {
    const update = jest.fn();
    findTickets.mockResolvedValue([
      { id: 8, companyId: 1, lastMessage: "oi @1", update },
      { id: 9, companyId: 1, lastMessage: "tchau @1", update }
    ]);
    findLast.mockResolvedValueOnce({ body: "outra", dataJson: "{}" }).mockResolvedValueOnce(null);

    expect(await BackfillMentionPreviewsService()).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
