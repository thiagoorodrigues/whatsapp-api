import { IntegrationError } from "../types";
import { buscarPorProximidade, centroDoBairro, escolherRaio, geocodificar, Lembrar } from "../plamev/proximidade";

// Sem cache: só executa.
const semCache: Lembrar = (_chave, _segundos, fn) => fn();

const daFiltros = (id: string, bairro: string, lat?: string, lng?: string, extra: Record<string, any> = {}) => ({
  Credenciados: { Id: id, NomeCredenciado: `Vet ${id}`, HoraMarcada: "1" },
  Individuos: { NomeFantasia: `Clínica ${id}` },
  IndividuosEnderecos: { Logradouro: "Rua A", Numero: "1", Bairro: bairro, Latitude: lat, Longitude: lng, CidadesNome: "Belo Horizonte", EstadosUF: "MG" },
  CredenciadosHorarioAtendimento: { a: { dias: "1,2,3,4,5", HorarioInicio: "08:00:00", HorarioFim: "18:00:00" } },
  MediaAvaliacoes: "4.9",
  ...extra
});

const localizado = (id: string, bairro: string, ponto: { lat: number; lng: number } | null) => ({
  credenciado: { id, nome: id, bairro } as any,
  ponto
});

describe("Plamev busca por proximidade", () => {
  it("centro do bairro é a média das clínicas dele com coordenada, sem acento nem caixa", () => {
    const lista = [
      localizado("a", "Santa Efigênia", { lat: -19.92, lng: -43.92 }),
      localizado("b", "santa efigenia", { lat: -19.94, lng: -43.94 }),
      localizado("c", "Santa Efigênia", null),
      localizado("d", "Funcionários", { lat: -19.0, lng: -43.0 })
    ];
    const centro = centroDoBairro(lista, "SANTA EFIGÊNIA");
    expect(centro?.n).toBe(2);
    expect(centro?.lat).toBeCloseTo(-19.93);
    expect(centro?.lng).toBeCloseTo(-43.93);
    expect(centroDoBairro(lista, "Savassi")).toBeNull();
  });

  it("fica no raio pedido quando ele tem o mínimo, senão sobe um degrau por vez até o teto", () => {
    expect(escolherRaio([0.5, 1, 2, 4], 3)).toEqual({ raio: 3, ampliado: false });
    expect(escolherRaio([0.5, 4, 6, 12], 3)).toEqual({ raio: 10, ampliado: true });
    // Nem o teto tem o mínimo: mostra o que houver nele.
    expect(escolherRaio([25, 38], 5)).toEqual({ raio: 40, ampliado: true });
    // Nada até o teto: não finge que ampliou.
    expect(escolherRaio([], 5)).toEqual({ raio: 5, ampliado: false });
    expect(escolherRaio([1], 5)).toEqual({ raio: 5, ampliado: false });
  });

  it("consulta no teto, recorta pelo raio e completa com a lista de cada cidade", async () => {
    const post = jest.fn(async () => [
      { Credenciados: { Id: "longe", CidadesId: "bh" }, DistanciaLinhaReta: 8.24 },
      { Credenciados: { Id: "perto", CidadesId: "bh" }, DistanciaLinhaReta: 0.54 },
      { Credenciados: { Id: "meio", CidadesId: "contagem" }, DistanciaLinhaReta: 2.36 },
      { Credenciados: { Id: "fora", CidadesId: "bh", NomeFantasia: "Fora da Lista", Ddd: "31", Telefone: "25151556", Bairro: "Prado", Cidade: "Belo Horizonte" }, DistanciaLinhaReta: 4.1 }
    ]);
    const get = jest.fn(async (_path: string, query?: Record<string, string | undefined>) =>
      query?.CidadesId === "bh" ? [daFiltros("perto", "Savassi"), daFiltros("longe", "Prado")] : [daFiltros("meio", "Eldorado")]
    );

    const r = await buscarPorProximidade(get, post, { origem: { lat: -19.93, lng: -43.93 }, raio: 5, imagemBase: "https://x/", lembrar: semCache });

    expect(post).toHaveBeenCalledWith("Credenciados/BuscaCredenciados", { Lat: -19.93, Lng: -43.93, Raio: 40 });
    expect(r).toMatchObject({ raio: 5, ampliado: false });
    expect(r.credenciados.map(c => [c.id, c.distanciaKm])).toEqual([
      ["perto", 0.5],
      ["meio", 2.4],
      ["fora", 4.1]
    ]);
    expect(r.credenciados[0]).toMatchObject({ nome: "Clínica perto", horaMarcada: true, horarios: ["Seg a Sex 08h–18h"], avaliacao: "4.9" });
    // Fora da lista da cidade: o formato curto, sem inventar horário.
    expect(r.credenciados[2]).toMatchObject({ nome: "Fora da Lista", telefone: "(31) 2515-1556", bairro: "Prado", horarios: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("'nenhum parceiro' da Plamev é lista vazia, não erro", async () => {
    const post = jest.fn(async () => {
      throw new IntegrationError("rejected", "A Plamev não aceitou: Nenhum parceiro localizado");
    });
    const r = await buscarPorProximidade(jest.fn(), post, { origem: { lat: 1, lng: 1 }, raio: 5, lembrar: semCache });
    expect(r).toEqual({ raio: 5, ampliado: false, credenciados: [] });

    const falha = jest.fn(async () => {
      throw new IntegrationError("unreachable", "A Plamev não respondeu a tempo.");
    });
    await expect(buscarPorProximidade(jest.fn(), falha, { origem: { lat: 1, lng: 1 }, raio: 5, lembrar: semCache })).rejects.toThrow("não respondeu");
  });

  it("geocoder: limpa CEP e país do rótulo; endereço não achado ou rota negada vira null", async () => {
    const get = jest.fn(async () => ({ Lat: -25.41, Lng: -49.26, Rotulo: "Juvevê, Curitiba - PR, 80030-000, Brazil", Precisao: "APPROXIMATE" }));
    expect(await geocodificar(get, "Juvevê, Curitiba - PR", semCache)).toEqual({ lat: -25.41, lng: -49.26, fonte: "mapa", rotulo: "Juvevê, Curitiba - PR" });
    expect(get).toHaveBeenCalledWith("Cidades/ConsultarCoordenadasEndereco", { Endereco: "Juvevê, Curitiba - PR" });

    const negada = jest.fn(async () => {
      throw new IntegrationError("unreachable", "A Plamev respondeu com erro 405.");
    });
    expect(await geocodificar(negada, "Savassi, Belo Horizonte - MG", semCache)).toBeNull();

    // Token recusado não é "endereço não achado": sobe.
    const recusado = jest.fn(async () => {
      throw new IntegrationError("auth", "A Plamev recusou o token.");
    });
    await expect(geocodificar(recusado, "x, y", semCache)).rejects.toThrow("recusou");
  });
});
