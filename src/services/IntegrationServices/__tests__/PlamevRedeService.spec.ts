const plamevGet = jest.fn();
const plamevPost = jest.fn();
const consultarCep = jest.fn();
const gerarImagemRede = jest.fn();
jest.mock("../providers/plamev/redeImagem", () => ({
  ...jest.requireActual("../providers/plamev/redeImagem"),
  gerarImagemRede: (...a: any[]) => gerarImagemRede(...a)
}));
jest.mock("../../../helpers/consultaCep", () => ({ consultarCep: (...a: any[]) => consultarCep(...a) }));
jest.mock("../providers/plamev/client", () => ({
  plamevGet: (...a: any[]) => plamevGet(...a),
  plamevPost: (...a: any[]) => plamevPost(...a)
}));
jest.mock("../CompanyIntegrationService", () => ({
  withSavedToken: async (companyId: number, key: string, fn: (t: string) => Promise<unknown>) => {
    if (companyId !== 7 || key !== "plamev") throw new Error("wrong company or provider");
    return fn("tok-777");
  }
}));

// eslint-disable-next-line import/first
import { bairros, cep, credenciados, cidades, estados, imagem, imagemPlano, planos, simular } from "../PlamevRedeService";

beforeEach(() => {
  plamevPost.mockReset();
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
      credenciados: [{ id: "k1", nome: "Vet", cep: "32600050", horarios: ["Seg 08h–18h", 3], plantao24h: "sim", logo: "x", extra: "ignorado" }]
    });
    expect(out.toString()).toBe("png");
    const [lista, opts] = gerarImagemRede.mock.calls[0];
    expect(lista[0]).toMatchObject({ id: "k1", nome: "Vet", cep: "32600050", horarios: ["Seg 08h–18h"], plantao24h: false, logo: "x" });
    expect(lista[0]).not.toHaveProperty("extra");
    expect(opts).toEqual({ imagemBase: "https://service.plamev-hm.com/" });
    await expect(imagem(8, { credenciados: [] })).rejects.toThrow("wrong company or provider");
  });

  it("requires the client state for plans and reads them with the company token", async () => {
    await expect(planos(7, "")).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
    plamevGet.mockResolvedValue({
      Coberturas: [{ Id: "c1", Nome: "SLIM ESSENCIAL (PADRÃO)", TiposCoberturasId: "17", TiposCoberturasNome: "Slim Essencial", OrigemCheckout: "SITE", ExibeSite: "1" }]
    });
    expect((await planos(7, "mg")).map(p => p.nome)).toEqual(["Slim Essencial"]);
    expect(plamevGet.mock.calls[0][1]).toBe("Coberturas/BuscarCoberturasComPreco/");
    expect(plamevGet.mock.calls[0][2]).toMatchObject({ EstadosId: "mg" });
  });

  it("draws a plan image only for the company with the integration", async () => {
    const png = await imagemPlano(7, { plano: { id: "c1", nome: "Slim", precoCartao: 49.99 } });
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
    await expect(imagemPlano(8, { plano: { id: "c1" } })).rejects.toThrow("wrong company or provider");
    await expect(imagemPlano(7, {})).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
  });

  it("simulates a quote with the company token through a POST", async () => {
    plamevPost.mockResolvedValue({ ValorTotalMensalidade: 139.99 });
    const r = await simular(7, {
      estadoId: "mg",
      formaPagamento: "cartao",
      pets: [{ especie: "cachorro", racaId: "r", nascimento: "2022-01-01", coberturaId: "c" }]
    });
    expect(r.totalMensal).toBe(139.99);
    expect(plamevPost.mock.calls[0][0]).toEqual({ apiUrl: "https://service.plamev-hm.com/", token: "tok-777" });
    expect(plamevPost.mock.calls[0][1]).toBe("Cotacoes/SimulaCotacaoPet");
  });

  it("passes the filters to the credenciados search", async () => {
    plamevGet.mockResolvedValue([]);
    expect(await credenciados(7, { cidadeId: "c1", bairro: "Centro" })).toEqual([]);
    expect(plamevGet.mock.calls[0][1]).toBe("Credenciados/BuscarCredenciadosFiltros/");
    expect(plamevGet.mock.calls[0][2]).toMatchObject({ CidadesId: "c1", Bairro: "Centro" });
  });
});
