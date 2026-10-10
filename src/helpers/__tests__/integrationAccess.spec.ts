const findByPk = jest.fn();
jest.mock("../../models/Company", () => ({ __esModule: true, default: { findByPk: (...a: any[]) => findByPk(...a) } }));
jest.mock("../../models/Plan", () => ({ __esModule: true, default: {} }));

// eslint-disable-next-line import/first
import { assertIntegration, companyIntegrations } from "../integrationAccess";

const withPlan = (integrations: unknown) => findByPk.mockResolvedValue({ plan: { integrations } });

beforeEach(() => {
  findByPk.mockReset();
  process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";
});

describe("integrationAccess", () => {
  it("returns the plan keys, ignoring unknown ones", async () => {
    withPlan(["plamev", "zzz"]);
    expect(await companyIntegrations(1)).toEqual(["plamev"]);
  });

  it("treats a null or invalid list as empty", async () => {
    withPlan(null);
    expect(await companyIntegrations(1)).toEqual([]);
    withPlan("plamev");
    expect(await companyIntegrations(1)).toEqual([]);
    findByPk.mockResolvedValue(null);
    expect(await companyIntegrations(1)).toEqual([]);
  });

  it("returns the provider when the plan has it", async () => {
    withPlan(["plamev"]);
    expect((await assertIntegration(1, "plamev")).key).toBe("plamev");
  });

  it("403 when the plan does not have it", async () => {
    withPlan([]);
    await expect(assertIntegration(1, "plamev")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_AVAILABLE", statusCode: 403 });
  });

  it("404 for an unknown key or a provider without configuration", async () => {
    withPlan(["plamev"]);
    await expect(assertIntegration(1, "nope")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_FOUND", statusCode: 404 });
    process.env.PLAMEV_API_URL = "";
    await expect(assertIntegration(1, "plamev")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_FOUND", statusCode: 404 });
  });
});
