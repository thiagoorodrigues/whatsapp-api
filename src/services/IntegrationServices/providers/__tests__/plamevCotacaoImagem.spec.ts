import { cotacaoDaTela, gerarImagemCotacao, montarSvgCotacao } from "../plamev/cotacaoImagem";

const cotacao = {
  formaPagamento: "cartao" as const,
  pets: [
    { nome: "Thor & Cia", especie: "cachorro" as const, plano: "Advance" },
    { nome: "Mia", especie: "gato" as const, plano: "Platinum Cat Comfort" }
  ],
  primeiraFatura: 233.97,
  mensalidade: 233.97,
  mesmoValor: true,
  semDesconto: 299.98,
  fidelidadeAte: "2027-10-12"
};

describe("cotação image", () => {
  it("draws pets, plans, the monthly price with the full price and loyalty", () => {
    const { svg } = montarSvgCotacao(cotacao);
    ["COTAÇÃO PLAMEV", "Thor &amp; Cia · Cachorro", "Plano Advance", "Mia · Gato", "Mensalidade (todos os pets)", "de R$ 299,98", "R$ 233,97", "/mês no cartão", "Fidelidade até 12/10/2027"].forEach(t =>
      expect(svg).toContain(t)
    );
    expect(svg).not.toContain("1ª fatura");
  });

  it("shows the first invoice and the monthly fee apart when they differ", () => {
    const { svg } = montarSvgCotacao({ ...cotacao, primeiraFatura: 119.99, mensalidade: 139.99, mesmoValor: false });
    ["1ª fatura (adesão)", "R$ 119,99", "no cartão", "Mensalidade: R$ 139,99/mês"].forEach(t => expect(svg).toContain(t));
    expect(svg).not.toContain("de R$ 299,98");
  });

  it("keeps only known fields from the browser and renders a PNG", () => {
    const c = cotacaoDaTela({ ...cotacao, formaPagamento: "boleto", campanha: "segredo", pets: [{ nome: "Rex", especie: "x", plano: "Slim" }], fidelidadeAte: "amanhã" });
    expect(c).not.toHaveProperty("campanha");
    expect(c).toMatchObject({ formaPagamento: "boleto", pets: [{ nome: "Rex", especie: "cachorro", plano: "Slim" }], fidelidadeAte: null });
    expect(montarSvgCotacao(c).svg).toContain("/mês no boleto");
    expect(gerarImagemCotacao(c).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(() => gerarImagemCotacao({ ...c, primeiraFatura: null })).toThrow("ERR_INTEGRATION_FILTER_REQUIRED");
  });
});
