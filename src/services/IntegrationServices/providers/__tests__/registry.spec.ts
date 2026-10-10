import { availableProviders, getProvider, sanitizeIntegrationKeys } from "..";

const OLD = process.env.PLAMEV_API_URL;
afterEach(() => { process.env.PLAMEV_API_URL = OLD; });

describe("integration registry", () => {
  it("lists Plamev only when PLAMEV_API_URL is set", () => {
    process.env.PLAMEV_API_URL = "";
    expect(availableProviders().map(p => p.key)).toEqual([]);
    process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";
    expect(availableProviders().map(p => p.key)).toEqual(["plamev"]);
  });

  it("Plamev exposes the two tools", () => {
    expect(getProvider("plamev")?.tools).toEqual([
      { key: "rede", label: "Rede credenciada" },
      { key: "planos", label: "Planos" }
    ]);
  });

  it("keeps only known keys, once, from any input", () => {
    expect(sanitizeIntegrationKeys(["plamev", "x", "plamev", 3])).toEqual(["plamev"]);
    expect(sanitizeIntegrationKeys(null)).toEqual([]);
    expect(sanitizeIntegrationKeys("plamev")).toEqual([]);
  });
});
