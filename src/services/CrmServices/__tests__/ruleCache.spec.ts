import FunnelRule from "../../../models/FunnelRule";
import { hasPlanFeature } from "../../../helpers/planFeature";
import { activeRules, invalidateRules, RULE_CACHE_MS } from "../ruleCache";

jest.mock("../../../helpers/planFeature", () => ({ hasPlanFeature: jest.fn() }));
jest.mock("../../../models/FunnelRule", () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock("../../../models/Funnel", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/FunnelStage", () => ({ __esModule: true, default: {} }));

const row = { id: 1, funnelId: 5, stageId: 25, whatsappId: 2, queueId: null };

beforeEach(() => {
  jest.clearAllMocks();
  invalidateRules(4);
  (hasPlanFeature as jest.Mock).mockResolvedValue(true);
  (FunnelRule.findAll as jest.Mock).mockResolvedValue([row]);
});

describe("activeRules", () => {
  it("loads active rules whose funnel is active and stage is open", async () => {
    expect(await activeRules(4, 0)).toEqual([row]);
    const query = (FunnelRule.findAll as jest.Mock).mock.calls[0][0];
    expect(query.where).toEqual({ companyId: 4, active: true });
    expect(query.include.map((i: any) => [i.as, i.where, i.required])).toEqual([
      ["funnel", { archived: false }, true],
      ["stage", { kind: "open", archived: false }, true]
    ]);
  });
  it("serves from memory for 60 seconds", async () => {
    await activeRules(4, 0);
    await activeRules(4, RULE_CACHE_MS - 1);
    expect(FunnelRule.findAll).toHaveBeenCalledTimes(1);
    await activeRules(4, RULE_CACHE_MS);
    expect(FunnelRule.findAll).toHaveBeenCalledTimes(2);
  });
  it("reloads right after an invalidation", async () => {
    await activeRules(4, 0);
    invalidateRules(4);
    await activeRules(4, 1);
    expect(FunnelRule.findAll).toHaveBeenCalledTimes(2);
  });
  it("returns nothing, without querying rules, when the plan has no CRM", async () => {
    (hasPlanFeature as jest.Mock).mockResolvedValue(false);
    expect(await activeRules(4, 0)).toEqual([]);
    expect(FunnelRule.findAll).not.toHaveBeenCalled();
  });
  it("drops a load that raced an invalidation", async () => {
    let release: (rows: any[]) => void = () => undefined;
    (FunnelRule.findAll as jest.Mock).mockReturnValueOnce(new Promise(r => { release = r; }));
    const stale = activeRules(4, 0);
    // Let the plan check resolve so findAll is the pending call.
    await new Promise(r => setImmediate(r));
    invalidateRules(4);
    release([{ ...row, id: 99 }]);
    expect((await stale).map(r => r.id)).toEqual([99]);
    (FunnelRule.findAll as jest.Mock).mockResolvedValueOnce([row]);
    expect((await activeRules(4, 1)).map(r => r.id)).toEqual([1]);
  });
});
