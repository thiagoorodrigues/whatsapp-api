import crmRoutes from "../crmRoutes";
import requirePlanFeature from "../../middleware/requirePlanFeature";

jest.mock("../../middleware/requirePlanFeature", () => {
  const guard = jest.fn((_req: any, _res: any, next: any) => next());
  return { __esModule: true, default: jest.fn(() => guard) };
});

// clearMocks wipes calls before each test, so keep the ones made at import.
const planCalls = (requirePlanFeature as jest.Mock).mock.calls.slice();
const guard = (requirePlanFeature as jest.Mock).mock.results[0].value;

describe("crmRoutes", () => {
  it("guards every route with isAuth and the useCrm plan feature", () => {
    expect(planCalls).toEqual([["useCrm"]]);
    const stacks = (crmRoutes as any).stack.map((layer: any) => ({
      path: layer.route.path,
      handlers: layer.route.stack.map((s: any) => s.handle)
    }));
    expect(stacks.length).toBe(17);
    for (const s of stacks) {
      expect(s.handlers[0].name).toBe("isAuth");
      expect(s.handlers[1]).toBe(guard);
    }
  });
  it("declares stages/order before stages/:stageId", () => {
    const paths = (crmRoutes as any).stack.map((l: any) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(paths.indexOf("put /crm/funnels/:funnelId/stages/order")).toBeLessThan(
      paths.indexOf("put /crm/funnels/:funnelId/stages/:stageId")
    );
  });
});
