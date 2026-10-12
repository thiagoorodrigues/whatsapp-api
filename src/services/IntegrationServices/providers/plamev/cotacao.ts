import AppError from "../../../../errors/AppError";
import { PlamevGetter } from "./rede";

// Simulação de cotação da Plamev (Cotacoes/SimulaCotacaoPet): não grava nada
// na Plamev (nem cotação, nem lead), só devolve os valores.

export type PlamevPoster = (path: string, body: unknown) => Promise<unknown>;

export type Especie = "gato" | "cachorro";
// Na Plamev: 1 = gato, 2 = cachorro (Racas/consultar e a cotação).
const ESPECIE: Record<Especie, string> = { gato: "1", cachorro: "2" };

export interface Raca {
  id: string;
  nome: string;
  porte: string | null;
}

export interface Campanha {
  id: string;
  nome: string;
  // A campanha que o site usa (ExibeSite = SIM).
  site: boolean;
}

export interface Tabela {
  id: string;
  nome: string;
  principal: boolean;
  porcentagem: number | null;
}

export interface PetCotacao {
  nome?: string;
  especie: Especie;
  racaId: string;
  nascimento: string; // YYYY-MM-DD
  coberturaId: string;
  campanhaId?: string;
  tabelaId?: string;
  cupom?: string;
}

export interface PedidoCotacao {
  estadoId: string;
  formaPagamento: "cartao" | "boleto";
  pets: PetCotacao[];
}

export interface Lancamento {
  nome: string;
  valor: number;
}

export interface ResultadoCotacao {
  formaPagamento: "cartao" | "boleto";
  mensalidade: number | null;
  desconto: number | null;
  totalMensal: number | null;
  // ValorAdesao da Plamev: o primeiro pagamento (adesão + 1ª mensalidade).
  primeiroPagamento: number | null;
  fidelidadeAte: string | null;
  mensalidadeItens: Lancamento[];
  adesaoItens: Lancamento[];
  pets: { nome: string; plano: string | null; valor: number | null }[];
}

export const MAX_PETS = 5;

type Raw = Record<string, any>;

const asList = (data: unknown): Raw[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return Object.values(data as Raw);
  return [];
};
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const money = (v: unknown): number | null => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const isSrd = (nome: string) => /^SRD\b|sem ra[çc]a/i.test(nome);

export const listRacas = async (get: PlamevGetter, especie: Especie): Promise<Raca[]> => {
  if (!ESPECIE[especie]) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return asList(await get("Racas/consultar", { Especie: ESPECIE[especie] }))
    .map(r => ({ id: text(r.Id), nome: text(r.Nome), porte: text(r.Porte) || null }))
    .filter(r => r.id && r.nome)
    .sort((a, b) => Number(isSrd(b.nome)) - Number(isSrd(a.nome)) || a.nome.localeCompare(b.nome, "pt-BR"));
};

export const listCampanhas = async (get: PlamevGetter, { tipoId, estadoId }: { tipoId: string; estadoId: string }): Promise<Campanha[]> => {
  if (!tipoId || !estadoId) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return asList(await get("CampanhasCoberturas/BuscarCampanhasCoberturas", { TiposCoberturasId: tipoId, EstadosId: estadoId }))
    .map(c => ({ id: text(c.CampanhasCoberturasId), nome: text(c.CampanhasCoberturasNome), site: text(c.ExibeSite).toUpperCase() === "SIM" }))
    .filter(c => c.id)
    .sort((a, b) => Number(b.site) - Number(a.site) || a.nome.localeCompare(b.nome, "pt-BR"));
};

export const listTabelas = async (get: PlamevGetter, campanhaId: string): Promise<Tabela[]> => {
  if (!campanhaId) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return asList(await get("CampanhasCoberturasTabelas/BuscarCampanhasCoberturasTabelas", { CampanhasCoberturasId: campanhaId }))
    .filter(t => !["0", "false"].includes(text(t.Ativo).toLowerCase()))
    .map(t => ({ id: text(t.Id), nome: text(t.Nome), principal: text(t.Tipo).toUpperCase() === "PRIMARIA", porcentagem: money(t.PorcentagemPadrao) }))
    .filter(t => t.id)
    .sort((a, b) => Number(b.principal) - Number(a.principal) || a.nome.localeCompare(b.nome, "pt-BR"));
};

const invalido = (motivo: string) => new AppError(motivo, 400);

const dataValida = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  // Até o fim de hoje em qualquer fuso (idade "menos de 1 ano" manda a data de hoje).
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getTime() <= Date.now() + 36 * 3600e3;
};

const petParaPlamev = (p: PetCotacao, i: number): Raw => {
  const n = i + 1;
  if (!ESPECIE[p?.especie]) throw invalido(`Escolha a espécie do pet ${n}.`);
  if (!text(p.racaId)) throw invalido(`Escolha a raça do pet ${n}.`);
  if (!dataValida(text(p.nascimento))) throw invalido(`Informe uma data de nascimento válida para o pet ${n}.`);
  if (!text(p.coberturaId)) throw invalido(`Escolha o plano do pet ${n}.`);
  const campanha = text(p.campanhaId);
  const tabela = text(p.tabelaId);
  if (campanha && !tabela) throw invalido(`Escolha a tabela da campanha do pet ${n}.`);
  const out: Raw = {
    Nome: text(p.nome).slice(0, 60) || `Pet ${n}`,
    Especie: ESPECIE[p.especie],
    RacasId: text(p.racaId),
    DataNascimento: text(p.nascimento),
    CoberturasId: text(p.coberturaId)
  };
  if (campanha) {
    out.CampanhasCoberturasId = campanha;
    out.CampanhasCoberturasTabelasId = tabela;
  }
  const cupom = text(p.cupom).slice(0, 40);
  if (cupom) out.CupomDesconto = cupom;
  return out;
};

const lancamentos = (raw: unknown): Lancamento[] =>
  asList(raw)
    .map(l => ({ nome: text(l.Nome).replace(/\s+/g, " "), valor: money(l.Valor) ?? 0 }))
    .filter(l => l.nome && l.valor !== 0);

export const simularCotacao = async (post: PlamevPoster, pedido: PedidoCotacao): Promise<ResultadoCotacao> => {
  if (!text(pedido?.estadoId)) throw invalido("Escolha o estado do cliente.");
  const forma = pedido.formaPagamento === "boleto" ? "boleto" : "cartao";
  const pets = Array.isArray(pedido.pets) ? pedido.pets : [];
  if (!pets.length) throw invalido("Inclua ao menos um pet.");
  if (pets.length > MAX_PETS) throw invalido(`Simule até ${MAX_PETS} pets por vez.`);
  const cotacoesPets = pets.map(petParaPlamev);

  const body: Raw = {
    FormaPagamento: forma === "cartao" ? 2 : 1,
    EstadosId: text(pedido.estadoId),
    OrigemCheckout: "SITE"
  };
  // Com campanha em algum pet, a precificação por campanha/tabela.
  if (cotacoesPets.some(p => p.CampanhasCoberturasId)) body.NovaCampanha = 1;
  body.CotacoesPets = cotacoesPets;

  const r: Raw = ((await post("Cotacoes/SimulaCotacaoPet", body)) || {}) as Raw;
  const desconto = money(r.ValorDescontosMensalidades);
  return {
    formaPagamento: forma,
    mensalidade: money(r.ValorMensalidade),
    desconto: desconto ? Math.abs(desconto) : null,
    totalMensal: money(r.ValorTotalMensalidade),
    primeiroPagamento: money(r.ValorAdesao),
    fidelidadeAte: text(r.DataFidelidade) || null,
    mensalidadeItens: lancamentos(r.ComposicaoMensalidade),
    adesaoItens: lancamentos(r.ComposicaoAdesao),
    pets: asList(r.Pets).map(p => ({ nome: text(p.Nome), plano: text(p.Planos?.Nome) || null, valor: money(p.ValorUnitario) }))
  };
};
