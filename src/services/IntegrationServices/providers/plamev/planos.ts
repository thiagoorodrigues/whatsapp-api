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
}

type Raw = Record<string, any>;

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
    procedimentos: int(valores.CoberturasQuantidadeProcedimentos)
  };
};

// Planos do estado do cliente, na ordem do site.
export const listPlanos = async (get: PlamevGetter, estadoId: string): Promise<Plano[]> => {
  const data: Raw = ((await get("Coberturas/BuscarCoberturasComPreco/", {
    EstadosId: estadoId,
    Valores: "true",
    order: "Ordem"
  })) || {}) as Raw;
  const lista: Raw[] = Array.isArray(data.Coberturas) ? data.Coberturas : Object.values(data.Coberturas || {});
  return lista
    .filter(c => String(c.OrigemCheckout).toUpperCase() === "SITE" && String(c.ExibeSite) === "1")
    .sort((a, b) => (Number(a.Ordem) || 0) - (Number(b.Ordem) || 0))
    .map(fromCobertura);
};
