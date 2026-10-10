import AppError from "../../../../errors/AppError";
import { Query } from "./client";

// Reads the Plamev API with the company token already bound.
export type PlamevGetter = (path: string, query?: Query) => Promise<unknown>;

export interface Estado {
  id: string;
  nome: string;
  uf: string;
}

export interface Cidade {
  id: string;
  nome: string;
}

export interface Credenciado {
  id: string;
  nome: string;
  endereco: string;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  plantao24h: boolean;
  coberturas: string[];
  avaliacao: string | null;
}

export interface RedeFiltros {
  estadoId?: string;
  cidadeId?: string;
  cep?: string;
  bairro?: string;
}

export const MAX_CREDENCIADOS = 50;

type Raw = Record<string, any>;

// Plamev returns lists either as arrays or as objects keyed "1", "2", ...
const asList = (data: unknown): Raw[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return Object.values(data as Raw);
  return [];
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const byName = <T extends { nome: string }>(a: T, b: T) => a.nome.localeCompare(b.nome, "pt-BR");

export const listEstados = async (get: PlamevGetter): Promise<Estado[]> =>
  asList(await get("Estados/consultar"))
    .map(e => ({ id: String(e.Id), nome: String(e.Nome ?? ""), uf: String(e.UF ?? "") }))
    .sort(byName);

export const listCidades = async (get: PlamevGetter, estadoId: string): Promise<Cidade[]> =>
  asList(await get("Cidades/consultar", { EstadosId: estadoId }))
    .map(c => ({ id: String(c.Id), nome: String(c.Nome ?? "") }))
    .sort(byName);

const fromFiltros = (i: Raw): Credenciado => {
  const c: Raw = i.Credenciados ?? {};
  const ind: Raw = i.Individuos ?? {};
  // Address comes as [] when the credenciado has none.
  const end: Raw = Array.isArray(i.IndividuosEnderecos) ? i.IndividuosEnderecos[0] ?? {} : i.IndividuosEnderecos ?? {};
  const contato: Raw = i.IndividuosContatos ?? {};
  const telefone = text(contato.Telefone);
  const ddd = text(contato.Ddd);
  return {
    id: String(c.Id),
    nome: text(ind.NomeFantasia) ?? text(c.NomeCredenciado) ?? text(ind.Nome) ?? "",
    endereco: [text(end.Logradouro), text(end.Numero)].filter(Boolean).join(", "),
    bairro: text(end.Bairro),
    cidade: text(end.CidadesNome) ?? text(end.Cidade),
    uf: text(end.EstadosNome) ?? text(end.Estado),
    cep: text(end.Cep),
    telefone: telefone ? (ddd ? `(${ddd}) ${telefone}` : telefone) : null,
    plantao24h: c.Plantao24h === "1" || c.Plantao24h === 1 || c.Plantao24h === true,
    coberturas: asList(i.CredenciadosCoberturas).map(x => text(x?.CoberturasNome)).filter((x): x is string => !!x),
    avaliacao: text(i.MediaAvaliacoes)
  };
};

// Needs a city or a full CEP; a state alone would list the whole state.
export const buscarCredenciados = async (get: PlamevGetter, filtros: RedeFiltros): Promise<Credenciado[]> => {
  const cep = (filtros.cep || "").replace(/\D/g, "");
  if (!filtros.cidadeId && cep.length !== 8) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  const data = await get("Credenciados/BuscarCredenciadosFiltros/", {
    Cep: cep || undefined,
    EstadosId: filtros.estadoId || undefined,
    CidadesId: filtros.cidadeId || undefined,
    Bairro: filtros.bairro?.trim() || undefined
  });
  return asList(data).slice(0, MAX_CREDENCIADOS).map(fromFiltros);
};
