import { cotacaoDaTela, gerarImagemCotacao, montarSvgCotacao } from "../plamev/cotacaoImagem";

const cotacao = {
  formaPagamento: "cartao" as const,
  pets: [
    { nome: "Thor & Cia", especie: "cachorro" as const, plano: "Advance" },
    { nome: "Mia", especie: "gato" as const, plano: "Platinum Cat Comfort" }
  ],
  mensalidade: 299.98,
  totalMensal: 272.98,
  primeiroPagamento: 233.97,
  fidelidadeAte: "2027-10-12"
};

describe("cotação image", () => {
  it("draws pets, plans, monthly total with the full price, first payment and loyalty", () => {
    const { svg } = montarSvgCotacao(cotacao);
    ["COTAÇÃO PLAMEV", "Thor &amp; Cia · Cachorro", "Plano Advance", "Mia · Gato", "Mensalidade (todos os pets)", "de R$ 299,98", "R$ 272,98", "/mês no cartão", "1º pagamento: R$ 233,97", "Fidelidade até 12/10/2027"].forEach(t =>
      expect(svg).toContain(t)
    );
  });

  it("keeps only known fields from the browser and renders a PNG", () => {
    const c = cotacaoDaTela({ ...cotacao, formaPagamento: "boleto", campanha: "segredo", pets: [{ nome: "Rex", especie: "x", plano: "Slim" }], fidelidadeAte: "amanhã" });
    expect(c).not.toHaveProperty("campanha");
    expect(c).toMatchObject({ formaPagamento: "boleto", pets: [{ nome: "Rex", especie: "cachorro", plano: "Slim" }], fidelidadeAte: null });
    expect(montarSvgCotacao(c).svg).toContain("/mês no boleto");
    expect(gerarImagemCotacao(c).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(() => gerarImagemCotacao({ ...c, totalMensal: null })).toThrow("ERR_INTEGRATION_FILTER_REQUIRED");
  });
});
