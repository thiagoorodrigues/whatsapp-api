import { formatReais, gerarImagemPlano, montarSvgPlano, planoDaTela } from "../plamev/planoImagem";
import { Plano } from "../plamev/planos";

const plano = (over: Partial<Plano> = {}): Plano => ({
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
  itens: ["Toda a cobertura do Slim", "Exames de imagem", "Cirurgias"],
  ...over
});

describe("plano image", () => {
  it("formats reais like pt-BR", () => {
    expect(formatReais(1139.9)).toBe("R$ 1.139,90");
  });

  it("draws name, species, prices, best seller, loyalty and procedures", () => {
    const { svg } = montarSvgPlano(plano());
    ["Advance", "Cães e gatos", "Mais vendido", "Indicado para peludinhos que precisam de mais procedimentos", "O que inclui", "Toda a cobertura do Slim", "Cirurgias", "R$ 139,99", "/mês no cartão", "de R$ 149,99", "R$ 149,99/mês no boleto", "Fidelidade de 12 meses", "41 procedimentos cobertos"].forEach(t =>
      expect(svg).toContain(t)
    );
  });

  it("leaves out what the plan does not have", () => {
    const { svg } = montarSvgPlano(plano({ maisVendido: false, precoCartaoSemDesconto: null, fidelidadeMeses: null, procedimentos: null, nome: "Cat & Co", resumo: null, itens: [] }));
    expect(svg).toContain("Cat &amp; Co");
    ["Mais vendido", "de R$", "Fidelidade", "procedimentos", "O que inclui", "font-style"].forEach(t => expect(svg).not.toContain(t));
  });

  it("renders a PNG from what the browser sends, keeping only known fields", () => {
    const p = planoDaTela({ ...plano(), precoCartao: "139.99", itens: ["Cirurgias", 3, ""], extra: "x" });
    expect(p.itens).toEqual(["Cirurgias"]);
    expect(p).not.toHaveProperty("extra");
    expect(p.precoCartao).toBe(139.99);
    expect(gerarImagemPlano(p).subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(() => gerarImagemPlano(null)).toThrow("ERR_INTEGRATION_FILTER_REQUIRED");
  });
});
