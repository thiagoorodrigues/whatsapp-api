const findByPk = jest.fn();
jest.mock("../../models/User", () => ({
  __esModule: true,
  default: { findByPk: (...a: any[]) => findByPk(...a) }
}));

/* eslint-disable import/first */
import isSuper from "../isSuper";
import isAdmin from "../isAdmin";
/* eslint-enable import/first */

const req = (profile = "admin"): any => ({ user: { id: "7", profile, companyId: 2 } });

describe("isSuper", () => {
  it("lets a super user through", async () => {
    findByPk.mockResolvedValue({ id: 7, super: true });
    const next = jest.fn();
    await isSuper(req(), {} as any, next);
    expect(next).toHaveBeenCalled();
    expect(findByPk).toHaveBeenCalledWith("7", { attributes: ["id", "super"] });
  });

  it("refuses an admin that is not super", async () => {
    findByPk.mockResolvedValue({ id: 7, super: false });
    const next = jest.fn();
    await expect(isSuper(req(), {} as any, next)).rejects.toMatchObject({ statusCode: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a user that no longer exists", async () => {
    findByPk.mockResolvedValue(null);
    await expect(isSuper(req(), {} as any, jest.fn())).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("isAdmin", () => {
  it("refuses a regular user and lets an admin through", () => {
    expect(() => isAdmin(req("user"), {} as any, jest.fn())).toThrow("ERR_NO_PERMISSION");
    const next = jest.fn();
    isAdmin(req("admin"), {} as any, next);
    expect(next).toHaveBeenCalled();
  });
});
