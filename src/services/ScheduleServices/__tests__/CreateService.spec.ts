const create = jest.fn();
const show = jest.fn();

jest.mock("../../../models/Schedule", () => ({ __esModule: true, default: { create: (...a: any[]) => create(...a) } }));
jest.mock("../ShowService", () => ({ __esModule: true, default: (...a: any[]) => show(...a) }));

// eslint-disable-next-line import/first
import CreateService from "../CreateService";

describe("CreateService", () => {
  // The agenda page reads schedule.contact.name from the socket event.
  it("returns the schedule with its contact, as ShowService does", async () => {
    create.mockResolvedValue({ id: 9 });
    const full = { id: 9, contact: { id: 3, name: "Ana" } };
    show.mockResolvedValue(full);

    const schedule = await CreateService({ body: "Oi Ana, tudo bem?", sendAt: "2030-01-15T10:00", contactId: 3, companyId: "1", whatsappsId: 2 });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ contactId: 3, companyId: "1", status: "PENDENTE" }));
    expect(show).toHaveBeenCalledWith(9, 1);
    expect(schedule).toBe(full);
  });
});
