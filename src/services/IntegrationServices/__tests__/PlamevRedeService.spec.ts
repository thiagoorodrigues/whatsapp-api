const plamevGet = jest.fn();
jest.mock("../providers/plamev/client", () => ({ plamevGet: (...a: any[]) => plamevGet(...a) }));
jest.mock("../CompanyIntegrationService", () => ({
  withSavedToken: async (companyId: number, key: string, fn: (t: string) => Promise<unknown>) => {
    if (companyId !== 7 || key !== "plamev") throw new Error("wrong company or provider");
    return fn("tok-777");
  }
}));

// eslint-disable-next-line import/first
import { credenciados, cidades, estados } from "../PlamevRedeService";

beforeEach(() => {
  plamevGet.mockReset();
  process.env.PLAMEV_API_URL = "https://service.plamev-hm.com/";
});

describe("PlamevRedeService", () => {
  it("reads states with the company token and the configured URL", async () => {
    plamevGet.mockResolvedValue([{ Id: "b", Nome: "Minas Gerais", UF: "MG" }]);
    expect(await estados(7)).toEqual([{ id: "b", nome: "Minas Gerais", uf: "MG" }]);
    expect(plamevGet).toHaveBeenCalledWith({ apiUrl: "https://service.plamev-hm.com/", token: "tok-777" }, "Estados/consultar", undefined);
  });

  it("requires the state for cities", async () => {
    await expect(cidades(7, "")).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
  });

  it("passes the filters to the credenciados search", async () => {
    plamevGet.mockResolvedValue([]);
    expect(await credenciados(7, { cidadeId: "c1", bairro: "Centro" })).toEqual([]);
    expect(plamevGet.mock.calls[0][1]).toBe("Credenciados/BuscarCredenciadosFiltros/");
    expect(plamevGet.mock.calls[0][2]).toMatchObject({ CidadesId: "c1", Bairro: "Centro" });
  });
});
