import { listCampanhas, listRacas, listTabelas, PetCotacao, simularCotacao } from "../plamev/cotacao";

const getter = (data: unknown) => jest.fn(async () => data);

describe("Plamev cotação: apoio", () => {
  it("lists the breeds of a species (gato = 1, cachorro = 2) with the SRD first", async () => {
    const get = getter([
      { Id: "b", Nome: "Beagle", Porte: "2" },
      { Id: "srd-m", Nome: "SRD (Sem Raça Definida) M", Porte: "2" },
      { Id: "a", Nome: "Akita", Porte: "3" }
    ]);
    expect(await listRacas(get, "cachorro")).toEqual([
      { id: "srd-m", nome: "SRD (Sem Raça Definida) M", porte: "2" },
      { id: "a", nome: "Akita", porte: "3" },
      { id: "b", nome: "Beagle", porte: "2" }
    ]);
    expect(get).toHaveBeenCalledWith("Racas/consultar", { Especie: "2" });
    await listRacas(get, "gato");
    expect(get).toHaveBeenLastCalledWith("Racas/consultar", { Especie: "1" });
  });

  it("lists the campaigns of a plan type in the state, the site one first", async () => {
    const get = getter([
      { CampanhasCoberturasId: "c2", CampanhasCoberturasNome: "ADVANCE 89", ExibeSite: "NAO" },
      { CampanhasCoberturasId: "c1", CampanhasCoberturasNome: "ADVANCE", ExibeSite: "SIM" }
    ]);
    expect(await listCampanhas(get, { tipoId: "4", estadoId: "mg" })).toEqual([
      { id: "c1", nome: "ADVANCE", site: true },
      { id: "c2", nome: "ADVANCE 89", site: false }
    ]);
    expect(get).toHaveBeenCalledWith("CampanhasCoberturas/BuscarCampanhasCoberturas", { TiposCoberturasId: "4", EstadosId: "mg" });
  });

  it("lists the active tables of a campaign, the primary one first", async () => {
    const get = getter([
      { Id: "t2", Nome: "Advance 99,98", Tipo: "SECUNDARIA", PorcentagemPadrao: "28.57", Ativo: "1" },
      { Id: "t0", Nome: "Inativa", Tipo: "SECUNDARIA", PorcentagemPadrao: "0", Ativo: "0" },
      { Id: "t1", Nome: "Advance 119,98", Tipo: "PRIMARIA", PorcentagemPadrao: "14.29", Ativo: "1" }
    ]);
    expect(await listTabelas(get, "c1")).toEqual([
      { id: "t1", nome: "Advance 119,98", principal: true, porcentagem: 14.29 },
      { id: "t2", nome: "Advance 99,98", principal: false, porcentagem: 28.57 }
    ]);
    expect(get).toHaveBeenCalledWith("CampanhasCoberturasTabelas/BuscarCampanhasCoberturasTabelas", { CampanhasCoberturasId: "c1" });
  });
});

describe("simularCotacao", () => {
  // Advance com a campanha do site (resposta real resumida): a campanha dá
  // desconto só na adesão; a mensalidade fica com o desconto do cartão.
  const resposta = {
    DataFidelidade: "2027-10-12",
    ValorAdesao: 119.985429,
    ValorMensalidade: 149.99,
    ValorTotalMensalidade: 139.99,
    ComposicaoMensalidade: [
      { Nome: "Mensalidade Plano ADVANCE Pet Thor", Valor: "149.99" },
      { Nome: "Desconto recorrente pagamento cartão de crédito Pet (Thor)", Valor: -10 },
      { Nome: "Desconto 1° Pet (Thor)", Valor: 0 }
    ],
    ComposicaoAdesao: [
      { Nome: "Taxa de Adesão  Pet Thor", Valor: "0.00" },
      { Nome: "Mensalidade Plano ADVANCE Pet Thor", Valor: "149.99" },
      { Nome: "Desconto recorrente pagamento cartão de crédito Pet (Thor)", Valor: -10 },
      { Nome: "Desconto adesão campanha ADVANCE Pet Thor", Valor: -20.004571 }
    ],
    Pets: [{ Nome: "Thor", ValorUnitario: "149.99", Planos: { Nome: "ADVANCE" } }]
  };
  const pet: PetCotacao = { nome: "Thor", especie: "cachorro", racaId: "srd-m", nascimento: "2022-01-01", coberturaId: "cob-adv", campanhaId: "c1", tabelaId: "t1" };

  it("sends the pets and answers like the site checkout: 1st invoice and monthly fee", async () => {
    const post = jest.fn(async () => resposta);
    const r = await simularCotacao(post, { estadoId: "mg", formaPagamento: "cartao", pets: [pet] });
    expect(post).toHaveBeenCalledWith("Cotacoes/SimulaCotacaoPet", {
      FormaPagamento: 2,
      EstadosId: "mg",
      OrigemCheckout: "SITE",
      NovaCampanha: 1,
      CotacoesPets: [
        { Nome: "Thor", Especie: "2", RacasId: "srd-m", DataNascimento: "2022-01-01", CoberturasId: "cob-adv", CampanhasCoberturasId: "c1", CampanhasCoberturasTabelasId: "t1" }
      ]
    });
    expect(r).toEqual({
      formaPagamento: "cartao",
      primeiraFatura: 119.99,
      mensalidade: 139.99,
      mesmoValor: false,
      semDesconto: 149.99,
      fidelidadeAte: "2027-10-12",
      composicaoPrimeiraFatura: [
        { nome: "Mensalidade Plano ADVANCE Pet Thor", valor: 149.99 },
        { nome: "Desconto recorrente pagamento cartão de crédito Pet (Thor)", valor: -10 },
        { nome: "Desconto adesão campanha ADVANCE Pet Thor", valor: -20 }
      ],
      composicaoMensalidade: [
        { nome: "Mensalidade Plano ADVANCE Pet Thor", valor: 149.99 },
        { nome: "Desconto recorrente pagamento cartão de crédito Pet (Thor)", valor: -10 }
      ],
      pets: [{ nome: "Thor", plano: "ADVANCE", valor: 149.99 }]
    });
  });

  it("includes a monthly campaign discount in the monthly fee, like the site ValorComDesconto", async () => {
    const comMensal = {
      ...resposta,
      ValorAdesao: 129.99,
      ComposicaoMensalidade: [...resposta.ComposicaoMensalidade, { Nome: "*** Desconto parcela campanha PLATINUM129  Pet Thor", Valor: -10 }]
    };
    const r = await simularCotacao(jest.fn(async () => comMensal), { estadoId: "mg", formaPagamento: "cartao", pets: [pet] });
    expect(r).toMatchObject({ primeiraFatura: 129.99, mensalidade: 129.99, mesmoValor: true });
  });

  it("without campaign: no NovaCampanha, boleto = 1, coupon sent", async () => {
    const post = jest.fn(async () => ({ ...resposta, ValorAdesao: 149.99, ComposicaoMensalidade: [{ Nome: "Mensalidade", Valor: "149.99" }] }));
    const r = await simularCotacao(post, { estadoId: "mg", formaPagamento: "boleto", pets: [{ ...pet, campanhaId: "", tabelaId: "", cupom: " PROMO10 " }] });
    const body = (post.mock.calls[0] as any)[1];
    expect(body.FormaPagamento).toBe(1);
    expect(body).not.toHaveProperty("NovaCampanha");
    expect(body.CotacoesPets[0]).toEqual({ Nome: "Thor", Especie: "2", RacasId: "srd-m", DataNascimento: "2022-01-01", CoberturasId: "cob-adv", CupomDesconto: "PROMO10" });
    expect(r).toMatchObject({ primeiraFatura: 149.99, mensalidade: 149.99, mesmoValor: true });
  });

  it("writes 'Pet 1' once when the pet has no name", async () => {
    const semNome = { ...resposta, ComposicaoMensalidade: [{ Nome: "Mensalidade Plano ADVANCE Pet Pet 1", Valor: "149.99" }] };
    const r = await simularCotacao(jest.fn(async () => semNome), { estadoId: "mg", formaPagamento: "cartao", pets: [{ ...pet, nome: "" }] });
    expect(r.composicaoMensalidade[0].nome).toBe("Mensalidade Plano ADVANCE Pet 1");
  });

  it("accepts today as birth date (less than 1 year old)", async () => {
    const post = jest.fn(async () => resposta);
    const hoje = new Date().toISOString().slice(0, 10);
    await simularCotacao(post, { estadoId: "mg", formaPagamento: "cartao", pets: [{ ...pet, nascimento: hoje }] });
    expect((post.mock.calls[0] as any)[1].CotacoesPets[0].DataNascimento).toBe(hoje);
  });

  it("refuses incomplete pets before calling the Plamev", async () => {
    const post = jest.fn();
    const tenta = (over: any, extra: any = {}) => simularCotacao(post, { estadoId: "mg", formaPagamento: "cartao", pets: [{ ...pet, ...over }], ...extra });
    await expect(tenta({ especie: "peixe" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tenta({ racaId: "" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tenta({ nascimento: "2099-01-01" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tenta({ nascimento: "31/12/2020" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tenta({ coberturaId: "" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tenta({ tabelaId: "" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(tenta({}, { estadoId: "" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(simularCotacao(post, { estadoId: "mg", formaPagamento: "cartao", pets: [] })).rejects.toMatchObject({ statusCode: 400 });
    expect(post).not.toHaveBeenCalled();
  });
});
