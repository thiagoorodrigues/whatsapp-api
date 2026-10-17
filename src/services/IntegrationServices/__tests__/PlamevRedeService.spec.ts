const plamevGet = jest.fn();
const plamevPost = jest.fn();
const consultarCep = jest.fn();
const gerarImagemRede = jest.fn();
jest.mock("../providers/plamev/redeImagem", () => ({
  ...jest.requireActual("../providers/plamev/redeImagem"),
  gerarImagemRede: (...a: any[]) => gerarImagemRede(...a)
}));
jest.mock("../../../helpers/consultaCep", () => ({ consultarCep: (...a: any[]) => consultarCep(...a) }));
const geocodificarEndereco = jest.fn();
jest.mock("../../../helpers/geocodificarEndereco", () => ({ geocodificarEndereco: (...a: any[]) => geocodificarEndereco(...a) }));
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
import { bairros, cep, credenciados, cidades, estados, imagem, imagemPlano, planos, proximidade, simular, sugestoesDeLocal } from "../PlamevRedeService";

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
      { Credenciados: { Id: "a" }, Individuos: { NomeFantasia: "Clínica A" }, IndividuosEnderecos: { Bairro: "Santa Efigênia" } },
      { Credenciados: { Id: "b" }, Individuos: { NomeFantasia: "Clínica B" }, IndividuosEnderecos: { Bairro: "Savassi" } },
      { Credenciados: { Id: "c" }, Individuos: { NomeFantasia: "Clínica C" }, IndividuosEnderecos: { Bairro: "Prado" } }
    ];
    const pertos = [
      { Credenciados: { Id: "a", CidadesId: "bh" }, DistanciaLinhaReta: 0.2 },
      { Credenciados: { Id: "b", CidadesId: "bh" }, DistanciaLinhaReta: 1.1 },
      { Credenciados: { Id: "c", CidadesId: "bh" }, DistanciaLinhaReta: 3.2 }
    ];
    const savassi = { lat: -19.937, lng: -43.935, rotulo: "Savassi, Belo Horizonte, MG", tipo: "neighbourhood" };

    beforeEach(() => {
      geocodificarEndereco.mockReset();
      consultarCep.mockReset();
    });

    it("exige um endereço de 3 a 200 letras", async () => {
      await expect(proximidade(7, {})).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
      await expect(proximidade(7, { endereco: " ab " })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
      await expect(proximidade(7, { endereco: "x".repeat(201) })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
    });

    it("acha o endereço no mapa e mede a distância de cada credenciado pela Plamev", async () => {
      geocodificarEndereco.mockResolvedValue(savassi);
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      const r = await proximidade(7, { endereco: "  Savassi,   Belo Horizonte ", raio: 5 });
      expect(geocodificarEndereco).toHaveBeenCalledWith("Savassi, Belo Horizonte");
      expect(r.origem).toEqual(savassi);
      expect(r).toMatchObject({ raio: 5, ampliado: false, maisProximas: false });
      expect(r.credenciados.map(c => [c.id, c.nome, c.distanciaKm])).toEqual([["a", "Clínica A", 0.2], ["b", "Clínica B", 1.1], ["c", "Clínica C", 3.2]]);
      expect(plamevPost).toHaveBeenCalledWith({ apiUrl: "https://service.plamev-hm.com/", token: "tok-777" }, "Credenciados/BuscaCredenciados", { Lat: -19.937, Lng: -43.935, Raio: 40 });
    });

    it("guarda o ponto do mapa em cache: a segunda busca do mesmo texto não consulta o mapa", async () => {
      geocodificarEndereco.mockResolvedValue(savassi);
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      await proximidade(7, { endereco: "Savassi, Belo Horizonte" });
      await proximidade(7, { endereco: "savassi, belo horizonte" });
      expect(geocodificarEndereco).toHaveBeenCalledTimes(1);
    });

    it("CEP vira rua, bairro e cidade pelo ViaCEP antes de ir ao mapa", async () => {
      consultarCep.mockResolvedValue({ cep: "30140040", cidade: "Belo Horizonte", uf: "MG", bairro: "Santa Efigênia", logradouro: "Rua Padre Marinho" });
      geocodificarEndereco.mockResolvedValue(savassi);
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      await proximidade(7, { endereco: "30140-040" });
      expect(consultarCep).toHaveBeenCalledWith("30140040");
      expect(geocodificarEndereco).toHaveBeenCalledWith("Rua Padre Marinho, Santa Efigênia, Belo Horizonte - MG");
    });

    it("ViaCEP fora do ar: o CEP vai ao mapa como texto", async () => {
      consultarCep.mockRejectedValue(new Error("ERR_CEP_UNAVAILABLE"));
      geocodificarEndereco.mockResolvedValue(savassi);
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      await proximidade(7, { endereco: "30140-040" });
      expect(geocodificarEndereco).toHaveBeenCalledWith("30140-040");
    });

    it("raio fora da lista vira o padrão", async () => {
      geocodificarEndereco.mockResolvedValue(savassi);
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      expect((await proximidade(7, { endereco: "Prado, Belo Horizonte", raio: 7 })).raio).toBe(5);
    });

    it("sugestão escolhida (ponto do IBGE) dispensa o mapa", async () => {
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      const r = await proximidade(7, { endereco: "Savassi, Belo Horizonte/MG", lat: -19.9359, lng: -43.93444 });
      expect(geocodificarEndereco).not.toHaveBeenCalled();
      expect(r.origem).toEqual({ lat: -19.9359, lng: -43.93444, rotulo: "Savassi, Belo Horizonte/MG", tipo: "ibge" });
      expect(plamevPost).toHaveBeenCalledWith(expect.anything(), "Credenciados/BuscaCredenciados", { Lat: -19.9359, Lng: -43.93444, Raio: 40 });
    });

    it("coordenada fora do Brasil ou inválida é ignorada: vai ao mapa pelo texto", async () => {
      geocodificarEndereco.mockResolvedValue(savassi);
      plamevGet.mockResolvedValue(daCidade);
      plamevPost.mockResolvedValue(pertos);
      await proximidade(7, { endereco: "Savassi, Belo Horizonte", lat: -43.93, lng: -19.93 });
      await proximidade(7, { endereco: "Savassi, Belo Horizonte", lat: NaN, lng: -43.9 });
      expect(geocodificarEndereco).toHaveBeenCalledTimes(1);
    });

    it("endereço que o mapa não acha: origem null, sem consultar a Plamev", async () => {
      geocodificarEndereco.mockResolvedValue(null);
      const r = await proximidade(7, { endereco: "Rua Que Não Existe, Lugar Nenhum" });
      expect(r).toEqual({ origem: null, raio: 5, ampliado: false, maisProximas: false, credenciados: [] });
      expect(plamevPost).not.toHaveBeenCalled();
    });
  });

  it("sugere lugares do IBGE sem passar pela Plamev", () => {
    expect(sugestoesDeLocal("savassi")[0]).toMatchObject({ rotulo: "Savassi, Belo Horizonte/MG" });
    expect(sugestoesDeLocal("")).toEqual([]);
    expect(plamevGet).not.toHaveBeenCalled();
  });
});
