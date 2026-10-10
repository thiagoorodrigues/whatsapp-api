process.env.SECRETS_KEY = "test-secret";
process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";

const rows: any[] = [];
const testConnection = jest.fn();
let planKeys: string[] = ["plamev"];

const row = (data: any) => ({
  ...data,
  update: jest.fn(async function update(this: any, v: any) { Object.assign(this, v); return this; }),
  destroy: jest.fn(async function destroy(this: any) { rows.splice(rows.indexOf(this), 1); })
});

jest.mock("../../../models/CompanyIntegration", () => {
  const match = (where: any) => (r: any) =>
    r.companyId === where.companyId && (Array.isArray(where.provider) ? where.provider.includes(r.provider) : r.provider === where.provider);
  const api = {
    findOne: async ({ where }: any) => rows.find(match(where)) || null,
    findAll: async ({ where }: any) => rows.filter(match(where)),
    create: async (data: any) => { const r = row(data); rows.push(r); return r; }
  };
  return { __esModule: true, default: { ...api, unscoped: () => api } };
});
jest.mock("../../../helpers/integrationAccess", () => {
  const AppError = jest.requireActual("../../../errors/AppError").default;
  return {
    companyIntegrations: async () => planKeys,
    assertIntegration: async (_c: number, key: string) => {
      if (!planKeys.includes(key)) throw new AppError("ERR_INTEGRATION_NOT_AVAILABLE", 403);
      const p = jest.requireActual("../providers").getProvider(key);
      return { ...p, testConnection };
    }
  };
});

// eslint-disable-next-line import/first
import { connect, disconnect, listForCompany, testSaved } from "../CompanyIntegrationService";
// eslint-disable-next-line import/first
import { IntegrationError } from "../providers";
// eslint-disable-next-line import/first
import { decryptSecret } from "../../../helpers/secretBox";

beforeEach(() => {
  rows.length = 0;
  planKeys = ["plamev"];
  testConnection.mockReset().mockResolvedValue(undefined);
});

describe("CompanyIntegrationService", () => {
  it("lists plan integrations as not connected at first", async () => {
    const [plamev] = await listForCompany(1);
    expect(plamev).toMatchObject({ key: "plamev", connected: false, status: null, tokenHint: null });
  });

  it("trims, tests, then stores the token encrypted and never returns it", async () => {
    const view = await connect(1, "plamev", "  tok-1234\n");
    expect(testConnection).toHaveBeenCalledWith("tok-1234");
    expect(decryptSecret(rows[0].tokenEncrypted)).toBe("tok-1234");
    expect(view).toMatchObject({ connected: true, status: "connected", tokenHint: "…1234" });
    expect(JSON.stringify(view)).not.toContain("tok-1234");
    expect(JSON.stringify(view)).not.toContain(rows[0].tokenEncrypted);
  });

  it("requires a token", async () => {
    await expect(connect(1, "plamev", "   ")).rejects.toMatchObject({ message: "ERR_INTEGRATION_TOKEN_REQUIRED" });
  });

  it("does not save a refused token", async () => {
    testConnection.mockRejectedValue(new IntegrationError("auth", "A Plamev recusou o token."));
    await expect(connect(1, "plamev", "bad")).rejects.toMatchObject({ message: "ERR_INTEGRATION_TOKEN_REJECTED", statusCode: 400 });
    expect(rows).toHaveLength(0);
  });

  it("does not save when the partner is down", async () => {
    testConnection.mockRejectedValue(new IntegrationError("unreachable", "A Plamev não respondeu a tempo."));
    await expect(connect(1, "plamev", "tok")).rejects.toMatchObject({ message: "ERR_INTEGRATION_UNREACHABLE", statusCode: 502 });
    expect(rows).toHaveLength(0);
  });

  it("replaces the token on a second connect", async () => {
    await connect(1, "plamev", "first-aaaa");
    await connect(1, "plamev", "second-bbbb");
    expect(rows).toHaveLength(1);
    expect(decryptSecret(rows[0].tokenEncrypted)).toBe("second-bbbb");
  });

  it("testSaved records an error instead of throwing", async () => {
    await connect(1, "plamev", "tok-9999");
    testConnection.mockRejectedValue(new IntegrationError("auth", "A Plamev recusou o token."));
    const view = await testSaved(1, "plamev");
    expect(view).toMatchObject({ connected: true, status: "error", lastError: "A Plamev recusou o token." });
  });

  it("testSaved without a token is 404", async () => {
    await expect(testSaved(1, "plamev")).rejects.toMatchObject({ message: "ERR_INTEGRATION_NOT_CONNECTED", statusCode: 404 });
  });

  it("hides an integration removed from the plan and brings it back connected", async () => {
    await connect(1, "plamev", "tok-1111");
    planKeys = [];
    expect(await listForCompany(1)).toEqual([]);
    await expect(connect(1, "plamev", "x")).rejects.toMatchObject({ statusCode: 403 });
    planKeys = ["plamev"];
    expect((await listForCompany(1))[0]).toMatchObject({ connected: true, tokenHint: "…1111" });
  });

  it("disconnect removes the row", async () => {
    await connect(1, "plamev", "tok");
    await disconnect(1, "plamev");
    expect(rows).toHaveLength(0);
  });
});
