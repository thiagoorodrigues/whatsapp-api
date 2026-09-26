import requirePlanFeature from "../requirePlanFeature";
import { hasPlanFeature } from "../../helpers/planFeature";

jest.mock("../../helpers/planFeature", () => ({ hasPlanFeature: jest.fn() }));

const run = async (enabled: boolean) => {
  (hasPlanFeature as jest.Mock).mockResolvedValue(enabled);
  const next = jest.fn();
  await requirePlanFeature("useCampaigns")({ user: { companyId: 7 } } as any, {} as any, next);
  return next;
};

describe("requirePlanFeature", () => {
  it("lets the request through when the plan has the feature", async () => {
    const next = await run(true);
    expect(hasPlanFeature).toHaveBeenCalledWith(7, "useCampaigns");
    expect(next).toHaveBeenCalledWith();
  });

  it("answers 403 when the plan lacks the feature", async () => {
    const next = await run(false);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("ERR_PLAN_FEATURE_NOT_AVAILABLE");
  });
});
