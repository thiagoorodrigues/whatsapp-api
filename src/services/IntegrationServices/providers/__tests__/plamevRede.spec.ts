import { buscarCredenciados, listCidades, listEstados, MAX_CREDENCIADOS } from "../plamev/rede";

const getter = (data: unknown) => jest.fn(async () => data);

describe("Plamev rede credenciada", () => {
  it("lists states from an array or an indexed object, sorted by name", async () => {
    const raw = { "1": { Id: "b", Nome: "Minas Gerais", UF: "MG" }, "2": { Id: "a", Nome: "Bahia", UF: "BA" } };
    expect(await listEstados(getter(raw))).toEqual([
      { id: "a", nome: "Bahia", uf: "BA" },
      { id: "b", nome: "Minas Gerais", uf: "MG" }
    ]);
    expect(await listEstados(getter([{ Id: "x", Nome: "Acre", UF: "AC" }]))).toEqual([{ id: "x", nome: "Acre", uf: "AC" }]);
    expect(await listEstados(getter(null))).toEqual([]);
  });

  it("lists the cities of a state", async () => {
    const get = getter({ "1": { Id: "c1", Nome: "Juiz de Fora", EstadosId: "b" } });
    expect(await listCidades(get, "b")).toEqual([{ id: "c1", nome: "Juiz de Fora" }]);
    expect(get).toHaveBeenCalledWith("Cidades/consultar", { EstadosId: "b" });
  });

  it("maps a credenciado, tolerating an empty address and no phone", async () => {
    const get = getter([
      {
        Credenciados: { Id: "k1", NomeCredenciado: "Vet JF", Plantao24h: "1" },
        Individuos: { NomeFantasia: "Clínica Vet JF", Nome: "Vet JF Ltda" },
        IndividuosEnderecos: { Logradouro: "Rua Halfeld", Numero: "100", Bairro: "Centro", Cep: "36010000", CidadesNome: "Juiz de Fora", EstadosNome: "MG" },
        IndividuosContatos: { Ddd: "32", Telefone: "32110000" },
        CredenciadosCoberturas: [{ CoberturasNome: "Consultas" }, { CoberturasNome: "Exames" }],
        MediaAvaliacoes: "4.8"
      },
      {
        Credenciados: { Id: "k2", NomeCredenciado: "Pet Sem Endereço", Plantao24h: "0" },
        Individuos: {},
        IndividuosEnderecos: [],
        IndividuosContatos: {}
      }
    ]);
    const list = await buscarCredenciados(get, { cep: "36015-350", cidadeId: "c1" });
    expect(get).toHaveBeenCalledWith("Credenciados/BuscarCredenciadosFiltros/", {
      Cep: "36015350",
      EstadosId: undefined,
      CidadesId: "c1",
      Bairro: undefined
    });
    expect(list[0]).toEqual({
      id: "k1",
      nome: "Clínica Vet JF",
      endereco: "Rua Halfeld, 100",
      bairro: "Centro",
      cidade: "Juiz de Fora",
      uf: "MG",
      cep: "36010000",
      telefone: "(32) 32110000",
      plantao24h: true,
      coberturas: ["Consultas", "Exames"],
      avaliacao: "4.8"
    });
    expect(list[1]).toMatchObject({ id: "k2", nome: "Pet Sem Endereço", endereco: "", telefone: null, plantao24h: false, coberturas: [] });
  });

  it("requires a city or a CEP", async () => {
    await expect(buscarCredenciados(getter([]), { estadoId: "b" })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED", statusCode: 400 });
    await expect(buscarCredenciados(getter([]), { cep: "12" })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
  });

  it("returns at most MAX_CREDENCIADOS", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ Credenciados: { Id: String(i), NomeCredenciado: `C${i}` } }));
    expect(await buscarCredenciados(getter(many), { cidadeId: "c1" })).toHaveLength(MAX_CREDENCIADOS);
  });
});
