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
const cache = new Map<string, string>();
jest.mock("../../../libs/cache", () => ({
  cacheLayer: {
    get: async (k: string) => cache.get(k) ?? null,
    set: async (k: string, v: string) => {
      cache.set(k, v);
    }
  }
}));
jest.mock("../CompanyIntegrationService", () => ({
  withSavedToken: async (companyId: number, key: string, fn: (t: string) => Promise<unknown>) => {
    if (companyId !== 7 || key !== "plamev") throw new Error("wrong company or provider");
    return fn("tok-777");
  }
}));

// eslint-disable-next-line import/first
import { IntegrationError } from "../providers/types";
// eslint-disable-next-line import/first
import { bairros, cep, credenciados, cidades, estados, imagem, imagemPlano, planos, proximidade, simular } from "../PlamevRedeService";

beforeEach(() => {
  cache.clear();
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
    plamevPost.mockResolvedValue({ ValorAdesao: 139.99, ComposicaoMensalidade: [{ Nome: "Mensalidade", Valor: "139.99" }], Pets: [] });
    const r = await simular(7, {
      estadoId: "mg",
      formaPagamento: "cartao",
      pets: [{ especie: "cachorro", racaId: "r", nascimento: "2022-01-01", coberturaId: "c" }]
    });
    expect(r).toMatchObject({ primeiraFatura: 139.99, mensalidade: 139.99, mesmoValor: true });
    expect(plamevPost.mock.calls[0][0]).toEqual({ apiUrl: "https://service.plamev-hm.com/", token: "tok-777" });
    expect(plamevPost.mock.calls[0][1]).toBe("Cotacoes/SimulaCotacaoPet");
  });

  it("passes the filters to the credenciados search", async () => {
    plamevGet.mockResolvedValue([]);
    expect(await credenciados(7, { cidadeId: "c1", bairro: "Centro" })).toEqual([]);
    expect(plamevGet.mock.calls[0][1]).toBe("Credenciados/BuscarCredenciadosFiltros/");
    expect(plamevGet.mock.calls[0][2]).toMatchObject({ CidadesId: "c1", Bairro: "Centro" });
  });

  describe("proximidade", () => {
    const daCidade = [
      { Credenciados: { Id: "a" }, Individuos: { NomeFantasia: "Clínica A" }, IndividuosEnderecos: { Bairro: "Santa Efigênia", Latitude: "-19.92", Longitude: "-43.92" } },
      { Credenciados: { Id: "b" }, Individuos: { NomeFantasia: "Clínica B" }, IndividuosEnderecos: { Bairro: "Savassi" } },
      { Credenciados: { Id: "c" }, Individuos: { NomeFantasia: "Clínica C" }, IndividuosEnderecos: { Bairro: "Prado", Latitude: "-19.93", Longitude: "-43.96" } }
    ];
    const pertos = [
      { Credenciados: { Id: "a", CidadesId: "bh" }, DistanciaLinhaReta: 0.2 },
      { Credenciados: { Id: "b", CidadesId: "bh" }, DistanciaLinhaReta: 1.1 },
      { Credenciados: { Id: "c", CidadesId: "bh" }, DistanciaLinhaReta: 3.2 }
    ];

    it("exige cidade e bairro", async () => {
      await expect(proximidade(7, { cidadeId: "bh" })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
      await expect(proximidade(7, { bairro: "Savassi" })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
    });

    it("parte do centro das clínicas do bairro, sem geocoder, e guarda a lista da cidade em cache", async () => {
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      const r = await proximidade(7, { cidadeId: "bh", bairro: "santa efigênia", cidade: "Belo Horizonte", uf: "MG", raio: 5 });
      expect(r.origem).toEqual({ lat: -19.92, lng: -43.92, fonte: "credenciados", rotulo: "santa efigênia" });
      expect(r.credenciados.map(c => [c.id, c.distanciaKm])).toEqual([["a", 0.2], ["b", 1.1], ["c", 3.2]]);
      expect(plamevPost).toHaveBeenCalledWith({ apiUrl: "https://service.plamev-hm.com/", token: "tok-777" }, "Credenciados/BuscaCredenciados", { Lat: -19.92, Lng: -43.92, Raio: 40 });
      // A lista da cidade serviu ao centro e aos dados completos: uma ida só à Plamev.
      expect(plamevGet).toHaveBeenCalledTimes(1);
      expect(plamevGet.mock.calls.some(c => c[1] === "Cidades/ConsultarCoordenadasEndereco")).toBe(false);
    });

    it("raio fora da lista vira o padrão", async () => {
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      expect((await proximidade(7, { cidadeId: "bh", bairro: "Prado", raio: 7 })).raio).toBe(5);
    });

    it("bairro sem clínica com endereço público: usa o geocoder da Plamev", async () => {
      plamevGet.mockImplementation(async (_o: unknown, path: string) =>
        path === "Cidades/ConsultarCoordenadasEndereco" ? { Lat: -19.938, Lng: -43.934, Rotulo: "Savassi, Belo Horizonte - MG, Brasil" } : daCidade
      );
      plamevPost.mockResolvedValue(pertos);
      const r = await proximidade(7, { cidadeId: "bh", bairro: "Savassi", cidade: "Belo Horizonte", uf: "MG" });
      expect(r.origem).toEqual({ lat: -19.938, lng: -43.934, fonte: "mapa", rotulo: "Savassi, Belo Horizonte - MG" });
      expect(plamevGet).toHaveBeenCalledWith(expect.anything(), "Cidades/ConsultarCoordenadasEndereco", { Endereco: "Savassi, Belo Horizonte - MG" });
    });

    it("sem ponto nenhum, devolve as clínicas do bairro pelo filtro da Plamev, sem distância", async () => {
      plamevGet.mockImplementation(async (_o: unknown, path: string, query?: Record<string, string>) => {
        if (path === "Cidades/ConsultarCoordenadasEndereco") throw new IntegrationError("unreachable", "A Plamev respondeu com erro 405.");
        // Endereço oculto: sem bairro no cadastro, mas a Plamev filtra por ele.
        if (query?.Bairro === "Savassi") return [{ Credenciados: { Id: "oculto" }, Individuos: { NomeFantasia: "Dr. X" }, IndividuosEnderecos: [] }];
        return daCidade;
      });
      const r = await proximidade(7, { cidadeId: "bh", bairro: "Savassi", cidade: "Belo Horizonte", uf: "MG" });
      expect(r).toMatchObject({ origem: null, ampliado: false });
      expect(r.credenciados.map(c => [c.id, c.distanciaKm])).toEqual([["oculto", null]]);
      expect(plamevPost).not.toHaveBeenCalled();
    });
  });
});
