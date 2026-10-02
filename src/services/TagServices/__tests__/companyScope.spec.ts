const tagFindOne = jest.fn();
const tagFindAll = jest.fn();
const ticketFindOne = jest.fn();
const ticketTagDestroy = jest.fn();
const ticketTagBulkCreate = jest.fn();
const ticketTagCreate = jest.fn();
const ticketTagFindAll = jest.fn();

jest.mock("../../../models/Tag", () => ({
  __esModule: true,
  default: {
    findOne: (...a: any[]) => tagFindOne(...a),
    findAll: (...a: any[]) => tagFindAll(...a)
  }
}));
jest.mock("../../../models/Ticket", () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => ticketFindOne(...a) }
}));
jest.mock("../../../models/TicketTag", () => ({
  __esModule: true,
  default: {
    destroy: (...a: any[]) => ticketTagDestroy(...a),
    bulkCreate: (...a: any[]) => ticketTagBulkCreate(...a),
    create: (...a: any[]) => ticketTagCreate(...a),
    findAll: (...a: any[]) => ticketTagFindAll(...a)
  }
}));

/* eslint-disable import/first */
import ShowService from "../ShowService";
import UpdateService from "../UpdateService";
import DeleteService from "../DeleteService";
import SyncTagsService from "../SyncTagsService";
import AddTicketTagService from "../AddTicketTagService";
import RemoveKanbanTicketTagsService from "../RemoveKanbanTicketTagsService";
/* eslint-enable import/first */

beforeEach(() => {
  [tagFindOne, tagFindAll, ticketFindOne, ticketTagDestroy, ticketTagBulkCreate, ticketTagCreate, ticketTagFindAll]
    .forEach(m => m.mockReset());
});

describe("tag services stay inside the company", () => {
  it("shows only a tag of the user's company", async () => {
    tagFindOne.mockResolvedValue(null);
    await expect(ShowService(7, 2)).rejects.toMatchObject({ message: "ERR_NO_TAG_FOUND", statusCode: 404 });
    expect(tagFindOne).toHaveBeenCalledWith({ where: { id: 7, companyId: 2 } });
  });

  it("does not update a tag of another company", async () => {
    tagFindOne.mockResolvedValue(null);
    await expect(UpdateService({ id: 7, companyId: 2, tagData: { name: "Outra" } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("deletes only a tag of the user's company", async () => {
    tagFindOne.mockResolvedValue(null);
    await expect(DeleteService(7, 2)).rejects.toMatchObject({ statusCode: 404 });
    expect(tagFindOne).toHaveBeenCalledWith({ where: { id: 7, companyId: 2 } });
  });

  it("sync refuses a ticket of another company and touches nothing", async () => {
    ticketFindOne.mockResolvedValue(null);
    await expect(SyncTagsService({ ticketId: 9, companyId: 2, tags: [{ id: 1 }] as any }))
      .rejects.toMatchObject({ message: "ERR_NO_TICKET_FOUND", statusCode: 404 });
    expect(ticketFindOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, companyId: 2 } }));
    expect(ticketTagDestroy).not.toHaveBeenCalled();
    expect(ticketTagBulkCreate).not.toHaveBeenCalled();
  });

  it("sync keeps only tags of the company", async () => {
    const ticket = { id: 9, reload: jest.fn() };
    ticketFindOne.mockResolvedValue(ticket);
    tagFindAll.mockResolvedValue([{ id: 1 }]);
    await SyncTagsService({ ticketId: 9, companyId: 2, tags: [{ id: 1 }, { id: 50 }] as any });
    expect(tagFindAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: [1, 50], companyId: 2 } }));
    expect(ticketTagDestroy).toHaveBeenCalledWith({ where: { ticketId: 9 } });
    expect(ticketTagBulkCreate).toHaveBeenCalledWith([{ tagId: 1, ticketId: 9 }]);
  });

  it("adding a tag requires ticket and tag of the company", async () => {
    ticketFindOne.mockResolvedValue({ id: 9 });
    tagFindOne.mockResolvedValue(null);
    await expect(AddTicketTagService({ ticketId: 9, tagId: 50, companyId: 2 }))
      .rejects.toMatchObject({ message: "ERR_NO_TAG_FOUND" });
    expect(tagFindOne).toHaveBeenCalledWith({ where: { id: 50, companyId: 2 } });
    expect(ticketTagCreate).not.toHaveBeenCalled();

    ticketFindOne.mockResolvedValue(null);
    await expect(AddTicketTagService({ ticketId: 9, tagId: 1, companyId: 2 }))
      .rejects.toMatchObject({ message: "ERR_NO_TICKET_FOUND" });
  });

  it("removing kanban tags refuses a ticket of another company", async () => {
    ticketFindOne.mockResolvedValue(null);
    await expect(RemoveKanbanTicketTagsService({ ticketId: 9, companyId: 2 }))
      .rejects.toMatchObject({ message: "ERR_NO_TICKET_FOUND" });
    expect(ticketTagDestroy).not.toHaveBeenCalled();
  });

  it("removing kanban tags only drops kanban tags of the company", async () => {
    ticketFindOne.mockResolvedValue({ id: 9 });
    tagFindAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    await RemoveKanbanTicketTagsService({ ticketId: 9, companyId: 2 });
    expect(tagFindAll).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 2, kanban: 1 } }));
    expect(ticketTagDestroy).toHaveBeenCalledWith({ where: { ticketId: 9, tagId: [3, 4] } });
  });
});
