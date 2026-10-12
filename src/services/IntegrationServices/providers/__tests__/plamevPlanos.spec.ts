import { listPlanos } from "../plamev/planos";

const cobertura = (over: Record<string, any> = {}) => ({
  Id: "c-adv",
  Nome: "ADVANCE",
  TiposCoberturasId: "4",
  TiposCoberturasNome: "Advance",
  OrigemCheckout: "SITE",
  ExibeSite: "1",
  Ordem: "2",
  Especie: "TODOS",
  MaisVendido: "1",
  Valores: [{ PlanosFidelidade: "12", CoberturasQuantidadeProcedimentos: "41" }],
  Cartao: { Composicao: { ValorComDesconto: "139.99", ValorMensalidade: "149.99", CampanhasCoberturasExibeSite: "SIM" } },
  Boleto: { Composicao: { ValorTotalMensalidade: "149.99" } },
  ...over
});

describe("listPlanos", () => {
  it("lists every plan the site sells in the state (origin SITE), in the site order, with card and boleto prices", async () => {
    const get = jest.fn(async () => ({
      Coberturas: [
        cobertura(),
        cobertura({ Id: "c-slim", Nome: "SLIM ESSENCIAL (PADRÃO)", TiposCoberturasNome: "Slim Essencial", TiposCoberturasId: "17", Ordem: "1", MaisVendido: "0",
          Cartao: { Composicao: { ValorComDesconto: "59.989999999999995", ValorMensalidade: "69.99", CampanhasCoberturasExibeSite: null } },
          Boleto: { Composicao: { ValorTotalMensalidade: "69.99" } } }),
        cobertura({ Id: "c-port", Nome: "ADVANCE PLUS PORTABILIDADE", TiposCoberturasNome: "Advance Plus", TiposCoberturasId: "14", Ordem: "14", MaisVendido: "0" }),
        cobertura({ Id: "c-slim1", Nome: "SLIM (PADRÃO)", TiposCoberturasNome: "Slim", TiposCoberturasId: "1", Ordem: "0", MaisVendido: "0" }),
        cobertura({ Id: "c-adv2", Nome: "ADVANCE 2", Ordem: "11", MaisVendido: "0" }),
        cobertura({ Id: "c-cat", Nome: "PLATINUM CAT COMFORT", TiposCoberturasNome: "Platinum Cat Comfort", TiposCoberturasId: "21", Ordem: "4", Especie: "FELINO", Valores: [], MaisVendido: "0" }),
        cobertura({ Id: "c-lp", OrigemCheckout: "LP" }),
        cobertura({ Id: "c-caixa", OrigemCheckout: "CAIXA" }),
        cobertura({ Id: "c-oculto", ExibeSite: "0" })
      ],
      ProcedimentosSite: [],
      TiposProcedimentos: []
    }));
    const planos = await listPlanos(get, "mg");
    expect(get).toHaveBeenCalledWith("Coberturas/BuscarCoberturasComPreco/", { EstadosId: "mg", Valores: "true", order: "Ordem" });
    expect(planos.map(p => p.id)).toEqual(["c-slim1", "c-slim", "c-adv", "c-cat", "c-adv2", "c-port"]);
    expect(planos.find(p => p.id === "c-port")).toMatchObject({ nome: "Advance Plus Portabilidade", resumo: "Cobertura incrível pelo melhor custo-benefício" });
    expect(planos.find(p => p.id === "c-slim1")).toMatchObject({ nome: "Slim", resumo: null, itens: [] });
    expect(planos[2]).toEqual({
      id: "c-adv",
      tipoId: "4",
      nome: "Advance",
      especie: "Cães e gatos",
      maisVendido: true,
      precoCartao: 139.99,
      precoCartaoSemDesconto: 149.99,
      precoBoleto: 149.99,
      fidelidadeMeses: 12,
      procedimentos: 41,
      resumo: "Indicado para peludinhos que precisam de mais procedimentos",
      itens: ["Toda a cobertura do Slim", "Exames laboratoriais", "Exames de imagem", "Internação", "Cirurgias"]
    });
    expect(planos[1]).toMatchObject({ nome: "Slim Essencial", precoCartao: 59.99, maisVendido: false, itens: ["Consultas", "Exames preventivos", "Vacina", "Consultas emergenciais ilimitadas"] });
    expect(planos[3]).toMatchObject({ nome: "Platinum Cat Comfort", especie: "Especial gatos", fidelidadeMeses: null, procedimentos: null });

  });

  it("shows the full price only when the card discount is a site campaign", async () => {
    const get = jest.fn(async () => ({
      Coberturas: [cobertura({ Cartao: { Composicao: { ValorComDesconto: "49.99", ValorMensalidade: "59.99", CampanhasCoberturasExibeSite: null } } })]
    }));
    const [plano] = await listPlanos(get, "mg");
    expect(plano.precoCartao).toBe(49.99);
    expect(plano.precoCartaoSemDesconto).toBeNull();
  });
});
