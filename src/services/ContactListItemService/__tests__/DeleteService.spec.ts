import DeleteService, { DeleteManyService } from "../DeleteService";
import ContactListItem from "../../../models/ContactListItem";

afterEach(() => jest.restoreAllMocks());

describe("DeleteService", () => {
  it("does not delete another company's contact", async () => {
    const find = jest.spyOn(ContactListItem, "findOne").mockResolvedValue(null);
    await expect(DeleteService(5, 2)).rejects.toMatchObject({ message: "ERR_NO_CONTACTLISTITEM_FOUND" });
    expect(find).toHaveBeenCalledWith({ where: { id: 5, companyId: 2 } });
  });
});

describe("DeleteManyService", () => {
  it("deletes only the company's contacts among the ids", async () => {
    const findAll = jest.spyOn(ContactListItem, "findAll").mockResolvedValue([{ id: 1 }, { id: 3 }] as any);
    const destroy = jest.spyOn(ContactListItem, "destroy").mockResolvedValue(2 as any);

    expect(await DeleteManyService([1, "3", 3, 9, "x", -1], 7)).toEqual([1, 3]);
    expect((findAll.mock.calls[0][0] as any).where.companyId).toBe(7);
    expect((destroy.mock.calls[0][0] as any).where.companyId).toBe(7);
  });

  it("refuses an empty selection", async () => {
    await expect(DeleteManyService([], 7)).rejects.toMatchObject({ message: "ERR_NO_CONTACTLISTITEM_SELECTED" });
    await expect(DeleteManyService("1,2", 7)).rejects.toMatchObject({ message: "ERR_NO_CONTACTLISTITEM_SELECTED" });
  });
});
