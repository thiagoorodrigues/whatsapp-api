import Company from "../../../models/Company";
import ShowPlanCompanyService from "../ShowPlanCompanyService";
import ListCompaniesPlanService from "../ListCompaniesPlanService";

jest.mock("../../../models/Company", () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), findAll: jest.fn().mockResolvedValue([]) }
}));

const planAttributes = (mock: jest.Mock) => mock.mock.calls[0][0].include[0].attributes;

describe("plan attributes sent to the frontend", () => {
  it("include the CRM fields for the company's own plan", async () => {
    await ShowPlanCompanyService(1);
    expect(planAttributes(Company.findOne as jest.Mock)).toEqual(expect.arrayContaining(["useCrm", "crmFunnels"]));
  });
  it("include the CRM fields in the companies list", async () => {
    await ListCompaniesPlanService();
    expect(planAttributes(Company.findAll as jest.Mock)).toEqual(expect.arrayContaining(["useCrm", "crmFunnels"]));
  });
});
