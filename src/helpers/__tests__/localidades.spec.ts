import { montarIndice, normalizar, sugerirLocalidades } from "../localidades";

// Recorte pequeno no formato do src/data/localidades-br.json.
const indice = montarIndice({
  cidades: [
    ["Belo Horizonte", "MG", -19.9237, -43.9363, 3106200],
    ["Belo Vale", "MG", -20.4077, -44.0275, 3106507],
    ["São Paulo", "SP", -23.5329, -46.6395, 3550308],
    ["Sete Lagoas", "MG", -19.4624, -44.2449, 3167202],
    ["Moema", "MG", -19.8387, -45.4127, 3142809]
  ],
  bairros: [
    ["Savassi", 0, -19.9359, -43.93444],
    ["São Paulo", 0, -19.8858, -43.9204],
    ["Santa Efigênia", 0, -19.9268, -43.925],
    ["Pinheiros", 2, -23.5671, -46.7018],
    ["Jardim Pinheiros", 2, -23.6, -46.75],
    ["Moema", 2, -23.6003, -46.6623]
  ]
});
const rotulos = (q: string) => sugerirLocalidades(q, 8, indice).map(s => s.rotulo);

describe("sugerirLocalidades", () => {
  it("acha pelo começo de uma palavra do nome, sem acento nem caixa", () => {
    expect(rotulos("sava")).toEqual(["Savassi, Belo Horizonte/MG"]);
    expect(rotulos("EFIG")).toEqual(["Santa Efigênia, Belo Horizonte/MG"]);
    expect(sugerirLocalidades("sava", 8, indice)[0]).toEqual({
      tipo: "bairro",
      nome: "Savassi",
      cidade: "Belo Horizonte",
      uf: "MG",
      lat: -19.9359,
      lng: -43.93444,
      rotulo: "Savassi, Belo Horizonte/MG"
    });
  });

  it("cidade antes de bairro de mesmo nome, e a cidade com mais lugares primeiro", () => {
    expect(rotulos("belo")).toEqual(["Belo Horizonte/MG", "Belo Vale/MG"]);
    expect(rotulos("são paulo")).toEqual(["São Paulo/SP", "São Paulo, Belo Horizonte/MG"]);
  });

  it("as outras palavras filtram pela cidade ou pela UF", () => {
    expect(rotulos("pinheiros sp")).toEqual(["Pinheiros, São Paulo/SP", "Jardim Pinheiros, São Paulo/SP"]);
    expect(rotulos("sao paulo bel")).toEqual(["São Paulo, Belo Horizonte/MG"]);
    expect(rotulos("moema sp")).toEqual(["Moema, São Paulo/SP"]);
  });

  it("sem bairro que case, sugere a cidade do fim do texto", () => {
    expect(rotulos("centro, sete lagoas")).toEqual(["Sete Lagoas/MG"]);
    expect(rotulos("rua tal sete lagoas")).toEqual(["Sete Lagoas/MG"]);
  });

  it("texto curto ou vazio não sugere nada", () => {
    expect(rotulos("s")).toEqual([]);
    expect(rotulos("   ")).toEqual([]);
  });

  it("respeita o limite", () => {
    expect(sugerirLocalidades("s", 1, indice)).toEqual([]);
    expect(sugerirLocalidades("sa", 2, indice)).toHaveLength(2);
  });

  it("normaliza acentos e pontuação", () => {
    expect(normalizar("  Juvevê, Curitiba-PR ")).toBe("juveve curitiba pr");
  });
});

describe("arquivo gerado do IBGE", () => {
  it("carrega e acha bairros reais", () => {
    expect(sugerirLocalidades("savassi", 3)[0]).toMatchObject({ rotulo: "Savassi, Belo Horizonte/MG", tipo: "bairro" });
    expect(sugerirLocalidades("taguatinga df", 3)[0]).toMatchObject({ rotulo: "Taguatinga, Brasília/DF" });
  });
});
