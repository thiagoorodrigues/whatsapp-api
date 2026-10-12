import { buscarCredenciados, horariosLegiveis, listBairros, listCidades, listEstados, localizarCidade, MAX_CREDENCIADOS } from "../plamev/rede";

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

  it("lists only the cities of a state that have credenciados", async () => {
    const get = getter([{ Id: "c2", Nome: "Uberlândia" }, { Id: "c1", Nome: "Juiz de Fora" }]);
    expect(await listCidades(get, "b")).toEqual([
      { id: "c1", nome: "Juiz de Fora" },
      { id: "c2", nome: "Uberlândia" }
    ]);
    expect(get).toHaveBeenCalledWith("Credenciados/BuscarCredenciadosCidades/", { EstadosId: "b" });
  });

  it("lists the neighborhoods of a city: filters by the raw value, shows a capitalized name", async () => {
    const get = getter([
      { Id: "santa efigênia", Nome: "santa efigênia" },
      { Id: "barro preto", Nome: "barro preto" },
      { Id: "vila da serra", Nome: "vila da serra" },
      { Id: "", Nome: "" }
    ]);
    expect(await listBairros(get, "c1")).toEqual([
      { id: "barro preto", nome: "Barro Preto" },
      { id: "santa efigênia", nome: "Santa Efigênia" },
      { id: "vila da serra", nome: "Vila da Serra" }
    ]);
    expect(get).toHaveBeenCalledWith("Credenciados/BuscarCredenciadosBairros/", { CidadesId: "c1" });
  });

  it("maps a credenciado, tolerating an empty address and no phone", async () => {
    const get = getter([
      {
        Credenciados: { Id: "k1", NomeCredenciado: "Vet JF", Plantao24h: "1", HoraMarcada: "1" },
        Individuos: { NomeFantasia: "Clínica Vet JF", Nome: "Vet JF Ltda", Imagem: "abc/123+x" },
        IndividuosEnderecos: { Logradouro: "Rua Halfeld", Numero: "100", Bairro: "Centro", Cep: "36010000", CidadesNome: "Juiz de Fora", EstadosNome: "Minas Gerais", EstadosUF: "MG" },
        CredenciadosHorarioAtendimento: {
          "9": { dias: "1,2,3,4,5", HorarioInicio: "08:00:00", HorarioFim: "18:00:00" },
          "75": { dias: "6", HorarioInicio: "08:00:00", HorarioFim: "13:00:00" }
        },
        IndividuosContatos: { Ddd: "32", Telefone: "32110000" },
        CredenciadosCoberturas: [{ CoberturasNome: "Consultas" }, { CoberturasNome: "Exames" }],
        MediaAvaliacoes: "4.8"
      },
      {
        Credenciados: { Id: "k2", NomeCredenciado: "Pet Sem Endereço", Plantao24h: "0" },
        Individuos: { Imagem: "onE5HCfRtC1BZO09" },
        IndividuosEnderecos: [],
        IndividuosContatos: {}
      }
    ]);
    const list = await buscarCredenciados(get, { cep: "36015-350", cidadeId: "c1" }, "https://service.plamev-hm.com");
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
      telefone: "(32) 3211-0000",
      plantao24h: true,
      horaMarcada: true,
      horarios: ["Seg a Sex 08h–18h", "Sáb 08h–13h"],
      coberturas: ["Consultas", "Exames"],
      avaliacao: "4.8",
      logo: "https://service.plamev-hm.com/bancoImagens/abc/123+x"
    });
    expect(list[1]).toMatchObject({ id: "k2", nome: "Pet Sem Endereço", endereco: "", telefone: null, plantao24h: false, horaMarcada: false, horarios: [], coberturas: [], logo: null });
  });

  it("groups the days that share the same hours, compactly", () => {
    expect(
      horariosLegiveis({
        a: { dias: "1,3,5", HorarioInicio: "08:00:00", HorarioFim: "20:00:00" },
        b: { dias: "2,4", HorarioInicio: "15:00:00", HorarioFim: "20:00:00" },
        c: { dias: "6", HorarioInicio: "08:00:00", HorarioFim: "12:00:00" }
      })
    ).toEqual(["Seg, Qua, Sex 08h–20h", "Ter, Qui 15h–20h", "Sáb 08h–12h"]);
    expect(
      horariosLegiveis([
        { dias: "1,2,3,5", HorarioInicio: "09:30:00", HorarioFim: "18:00:00" },
        { dias: "6,7", HorarioInicio: "10:00:00", HorarioFim: "14:00:00" }
      ])
    ).toEqual(["Seg a Qua, Sex 09h30–18h", "Sáb, Dom 10h–14h"]);
    // 00:00 às 00:00 é dia sem atendimento cadastrado: não aparece.
    expect(horariosLegiveis([{ dias: "7", HorarioInicio: "00:00:00", HorarioFim: "00:00:00" }])).toEqual([]);
    expect(horariosLegiveis(null)).toEqual([]);
  });

  it("finds the state and the city with credenciados of an address, ignoring accents and case", async () => {
    const get = jest.fn(async (path: string) =>
      path === "Estados/consultar"
        ? [{ Id: "mg", Nome: "Minas Gerais", UF: "MG" }]
        : [{ Id: "bh", Nome: "Belo Horizonte" }, { Id: "jf", Nome: "Juiz de Fora" }]
    );
    expect(await localizarCidade(get, { uf: "mg", cidade: "BELO HORIZONTE" })).toEqual({
      estado: { id: "mg", nome: "Minas Gerais", uf: "MG" },
      cidade: { id: "bh", nome: "Belo Horizonte" }
    });
    expect(await localizarCidade(get, { uf: "MG", cidade: "Uberlândia" })).toMatchObject({ cidade: null });
    expect(await localizarCidade(get, { uf: "SP", cidade: "Santos" })).toEqual({ estado: null, cidade: null });
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
