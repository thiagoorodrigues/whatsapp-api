import { PlamevGetter } from "./rede";

// Plano como o site da Plamev vende: só a origem SITE e exibida no site.
export interface Plano {
  id: string;
  tipoId: string;
  nome: string;
  especie: string;
  maisVendido: boolean;
  // Mensalidade no cartão (com o desconto do cartão).
  precoCartao: number | null;
  // Valor cheio riscado, só quando há campanha no site (como o site mostra).
  precoCartaoSemDesconto: number | null;
  precoBoleto: number | null;
  fidelidadeMeses: number | null;
  procedimentos: number | null;
  // Resumo comercial do plano (a API não traz: vem do material da Plamev).
  resumo: string | null;
  itens: string[];
}

type Raw = Record<string, any>;

// Resumo por tipo de plano (TiposCoberturasId), do material de divulgação da
// Plamev e das descrições do site; a API não tem esse texto. Tipo sem entrada
// fica sem resumo.
export const RESUMOS: Record<string, { resumo: string; itens: string[] }> = {
  "17": {
    resumo: "Para quem busca uma assistência preventiva para o seu peludinho",
    itens: ["Consultas", "Exames preventivos", "Vacina", "Consultas emergenciais ilimitadas"]
  },
  "4": {
    resumo: "Indicado para peludinhos que precisam de mais procedimentos",
    itens: ["Toda a cobertura do Slim", "Exames laboratoriais", "Exames de imagem", "Internação", "Cirurgias"]
  },
  "5": {
    resumo: "Especial para o peludinho que precisa de um pouco mais de atenção",
    itens: ["Toda a cobertura do Advance", "Exames sorológicos", "Testes hormonais", "Consultas com especialistas", "Vacinas especiais"]
  },
  "21": {
    resumo: "Um plano pensado para você cuidar do seu gatinho",
    itens: ["Toda a cobertura do Advance", "Exames sorológicos", "Testes hormonais", "Consultas com especialistas", "Vacina V5", "Teste FIV/FeLV"]
  }
};

// Os tipos que o site e o checkout da Plamev oferecem (defaultPlanIds no
// checkout do plamevpets): Slim Essencial, Advance, Platinum e Platinum Cat
// Comfort. Os demais só entram por link direto.
export const TIPOS_DO_SITE = ["17", "4", "5", "21"];

const ESPECIES: Record<string, string> = { TODOS: "Cães e gatos", CANINO: "Cães", FELINO: "Especial gatos" };

const money = (v: unknown): number | null => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const int = (v: unknown): number | null => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const title = (v: string): string =>
  v
    .toLowerCase()
    .split(/\s+/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// "ADVANCE PLUS PORTABILIDADE" com tipo "Advance Plus" → "Advance Plus Portabilidade";
// "(PADRÃO)" e o próprio nome do tipo não acrescentam nada.
const nomeDoPlano = (c: Raw): string => {
  const tipo = String(c.TiposCoberturasNome || c.Nome || "").trim();
  const resto = String(c.Nome || "")
    .replace(/\(PADR[ÃA]O\)/i, "")
    .trim()
    .toUpperCase()
    .replace(tipo.toUpperCase(), "")
    .trim();
  return resto && !/^\d+$/.test(resto) ? `${tipo} ${title(resto)}` : tipo;
};

const fromCobertura = (c: Raw): Plano => {
  const valores: Raw = (Array.isArray(c.Valores) ? c.Valores[0] : null) || {};
  const cartao: Raw = c.Cartao?.Composicao || {};
  const boleto: Raw = c.Boleto?.Composicao || {};
  const precoCartao = money(cartao.ValorComDesconto) ?? money(cartao.ValorTotalMensalidade);
  const cheio = money(cartao.ValorMensalidade);
  const campanha = String(cartao.CampanhasCoberturasExibeSite || "").toUpperCase() === "SIM";
  const resumo = RESUMOS[String(c.TiposCoberturasId ?? "")];
  return {
    id: String(c.Id),
    tipoId: String(c.TiposCoberturasId ?? ""),
    nome: nomeDoPlano(c),
    especie: ESPECIES[String(c.Especie || "TODOS").toUpperCase()] || "Cães e gatos",
    maisVendido: String(c.MaisVendido) === "1",
    precoCartao,
    precoCartaoSemDesconto: campanha && cheio && precoCartao && cheio > precoCartao ? cheio : null,
    precoBoleto: money(boleto.ValorTotalMensalidade),
    fidelidadeMeses: int(valores.PlanosFidelidade),
    procedimentos: int(valores.CoberturasQuantidadeProcedimentos),
    resumo: resumo?.resumo || null,
    itens: resumo?.itens || []
  };
};

// Planos do estado do cliente como o checkout do site: origem SITE, exibidos no
// site, só os tipos do site e um por tipo (o primeiro na ordem).
export const listPlanos = async (get: PlamevGetter, estadoId: string): Promise<Plano[]> => {
  const data: Raw = ((await get("Coberturas/BuscarCoberturasComPreco/", {
    EstadosId: estadoId,
    Valores: "true",
    order: "Ordem"
  })) || {}) as Raw;
  const lista: Raw[] = Array.isArray(data.Coberturas) ? data.Coberturas : Object.values(data.Coberturas || {});
  const vistos = new Set<string>();
  return lista
    .filter(c => String(c.OrigemCheckout).toUpperCase() === "SITE" && String(c.ExibeSite) === "1")
    .filter(c => TIPOS_DO_SITE.includes(String(c.TiposCoberturasId)))
    .sort((a, b) => (Number(a.Ordem) || 0) - (Number(b.Ordem) || 0))
    .filter(c => {
      const tipo = String(c.TiposCoberturasId);
      if (vistos.has(tipo)) return false;
      vistos.add(tipo);
      return true;
    })
    .map(fromCobertura);
};
