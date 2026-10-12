const plamevGet = jest.fn();
const consultarCep = jest.fn();
const gerarImagemRede = jest.fn();
jest.mock("../providers/plamev/redeImagem", () => ({
  ...jest.requireActual("../providers/plamev/redeImagem"),
  gerarImagemRede: (...a: any[]) => gerarImagemRede(...a)
}));
jest.mock("../../../helpers/consultaCep", () => ({ consultarCep: (...a: any[]) => consultarCep(...a) }));
jest.mock("../providers/plamev/client", () => ({ plamevGet: (...a: any[]) => plamevGet(...a) }));
jest.mock("../CompanyIntegrationService", () => ({
  withSavedToken: async (companyId: number, key: string, fn: (t: string) => Promise<unknown>) => {
    if (companyId !== 7 || key !== "plamev") throw new Error("wrong company or provider");
    return fn("tok-777");
  }
}));

// eslint-disable-next-line import/first
import { bairros, cep, credenciados, cidades, estados, imagem } from "../PlamevRedeService";

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

  it("requires the city for neighborhoods and reads them with the company token", async () => {
    await expect(bairros(7, "")).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
    plamevGet.mockResolvedValue([{ Id: "centro", Nome: "centro" }]);
    expect(await bairros(7, "c1")).toEqual([{ id: "centro", nome: "Centro" }]);
    expect(plamevGet.mock.calls[0][2]).toEqual({ CidadesId: "c1" });
  });

  it("turns the client CEP into the city with credenciados", async () => {
    consultarCep.mockResolvedValue({ cep: "32600000", cidade: "Betim", uf: "MG", bairro: "Angola" });
    plamevGet.mockImplementation(async (_o: unknown, path: string) =>
      path === "Estados/consultar" ? [{ Id: "mg", Nome: "Minas Gerais", UF: "MG" }] : [{ Id: "bt", Nome: "Betim" }]
    );
    expect(await cep(7, "32600-000")).toEqual({
      cep: "32600000",
      cidade: "Betim",
      uf: "MG",
      bairro: "Angola",
      estado: { id: "mg", nome: "Minas Gerais", uf: "MG" },
      cidadeRede: { id: "bt", nome: "Betim" }
    });
  });

  it("says when the CEP does not exist", async () => {
    consultarCep.mockResolvedValue(null);
    await expect(cep(7, "99999999")).rejects.toMatchObject({ message: "ERR_CEP_NOT_FOUND", statusCode: 404 });
  });

  it("draws the image only with the fields it uses, through the company token", async () => {
    gerarImagemRede.mockResolvedValue(Buffer.from("png"));
    const out = await imagem(7, {
      titulo: " Betim/MG ",
      credenciados: [{ id: "k1", nome: "Vet", horarios: ["Seg 08h–18h", 3], plantao24h: "sim", logo: "x", extra: "ignorado" }]
    });
    expect(out.toString()).toBe("png");
    const [lista, opts] = gerarImagemRede.mock.calls[0];
    expect(lista[0]).toMatchObject({ id: "k1", nome: "Vet", horarios: ["Seg 08h–18h"], plantao24h: false, logo: "x" });
    expect(lista[0]).not.toHaveProperty("extra");
    expect(opts).toEqual({ titulo: "Betim/MG", imagemBase: "https://service.plamev-hm.com/" });
    await expect(imagem(8, { credenciados: [] })).rejects.toThrow("wrong company or provider");
  });

  it("passes the filters to the credenciados search", async () => {
    plamevGet.mockResolvedValue([]);
    expect(await credenciados(7, { cidadeId: "c1", bairro: "Centro" })).toEqual([]);
    expect(plamevGet.mock.calls[0][1]).toBe("Credenciados/BuscarCredenciadosFiltros/");
    expect(plamevGet.mock.calls[0][2]).toMatchObject({ CidadesId: "c1", Bairro: "Centro" });
  });
});
