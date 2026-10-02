const findAll = jest.fn();

jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findAll(...a) } }));

// eslint-disable-next-line import/first
import FindNumberInUseService from "../FindNumberInUseService";

const connection: any = { id: 4, companyId: 1 };

beforeEach(() => findAll.mockReset());

describe("FindNumberInUseService", () => {
  it("finds another connection of the company with the number connected", async () => {
    findAll.mockResolvedValue([{ id: 3, name: "Thiago Rodrigues" }]);
    const twin = await FindNumberInUseService(connection, "553191673107", () => true);
    expect(twin).toEqual({ id: 3, name: "Thiago Rodrigues" });
    expect(findAll.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ companyId: 1, number: "553191673107", status: "CONNECTED" })
    );
  });

  it("ignores a connection marked connected that is not running", async () => {
    findAll.mockResolvedValue([{ id: 3, name: "Thiago Rodrigues" }]);
    expect(await FindNumberInUseService(connection, "553191673107", () => false)).toBeNull();
  });

  it("allows the number when no other connection has it", async () => {
    findAll.mockResolvedValue([]);
    expect(await FindNumberInUseService(connection, "553191673107", () => true)).toBeNull();
  });
});
