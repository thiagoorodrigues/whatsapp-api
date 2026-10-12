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
  horaMarcada: boolean;
  // "Seg a Sex, 08:00 às 18:00", como no site da Plamev.
  horarios: string[];
  coberturas: string[];
  avaliacao: string | null;
  // Logo pública da clínica (sem token), ou null quando não tem.
  logo: string | null;
}

// id is the raw value the Plamev filters by (it comes lowercased); nome is for display.
export interface Bairro {
  id: string;
  nome: string;
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

// Only the cities of the state that have credenciados.
export const listCidades = async (get: PlamevGetter, estadoId: string): Promise<Cidade[]> =>
  asList(await get("Credenciados/BuscarCredenciadosCidades/", { EstadosId: estadoId }))
    .map(c => ({ id: String(c.Id), nome: String(c.Nome ?? "") }))
    .sort(byName);

const LOWER_WORDS = new Set(["da", "das", "de", "do", "dos", "e"]);
const capitalize = (name: string): string =>
  name
    .split(/\s+/)
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

// Only the neighborhoods of the city that have credenciados.
export const listBairros = async (get: PlamevGetter, cidadeId: string): Promise<Bairro[]> =>
  asList(await get("Credenciados/BuscarCredenciadosBairros/", { CidadesId: cidadeId }))
    .map(b => text(b.Id))
    .filter((id): id is string => !!id)
    .map(id => ({ id, nome: capitalize(id) }))
    .sort(byName);

const flag = (v: unknown): boolean => v === "1" || v === 1 || v === true;

const DIAS: Record<number, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom" };
const hhmm = (v: unknown): string => String(v ?? "").slice(0, 5);

// CredenciadosHorarioAtendimento: linhas com dias "1,2,3" (1 = segunda) e um
// horário. Junta dias seguidos com o mesmo horário ("Seg a Sex"), como
// groupHorariosPorDia do site. 00:00 às 00:00 é dia sem atendimento: fica fora.
export const horariosLegiveis = (raw: unknown): string[] => {
  const porDia = asList(raw)
    .flatMap(h =>
      String(h?.dias ?? "")
        .split(",")
        .map(d => Number(d.trim()))
        .filter(d => DIAS[d])
        .map(dia => ({ dia, inicio: hhmm(h.HorarioInicio), fim: hhmm(h.HorarioFim) }))
    )
    .filter(h => h.inicio && h.fim && !(h.inicio === "00:00" && h.fim === "00:00"))
    .sort((a, b) => a.dia - b.dia);
  const grupos: { dias: number[]; inicio: string; fim: string }[] = [];
  porDia.forEach(h => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.inicio === h.inicio && ultimo.fim === h.fim && h.dia === ultimo.dias[ultimo.dias.length - 1] + 1) {
      ultimo.dias.push(h.dia);
    } else {
      grupos.push({ dias: [h.dia], inicio: h.inicio, fim: h.fim });
    }
  });
  return grupos.map(({ dias, inicio, fim }) => {
    const nomes = dias.map(d => DIAS[d]);
    let rotulo = nomes[0];
    if (nomes.length >= 3) rotulo = `${nomes[0]} a ${nomes[nomes.length - 1]}`;
    else if (nomes.length === 2) rotulo = `${nomes[0]} e ${nomes[1]}`;
    return `${rotulo}, ${inicio} às ${fim}`;
  });
};

// 8 dígitos: 3211-0000; 9 dígitos: 99811-5265.
const formatPhone = (ddd: string | null, numero: string): string => {
  const d = numero.replace(/\D/g, "");
  const local = d.length === 8 || d.length === 9 ? `${d.slice(0, -4)}-${d.slice(-4)}` : numero;
  return ddd ? `(${ddd}) ${local}` : local;
};

// Individuos.Imagem é a chave do arquivo em bancoImagens/ (o mesmo do site da
// Plamev); este valor é o "sem imagem" deles.
const SEM_IMAGEM = "onE5HCfRtC1BZO09";
const logoUrl = (imagemBase: string | undefined, imagem: string | null): string | null => {
  if (!imagemBase || !imagem || imagem === SEM_IMAGEM) return null;
  const base = imagemBase.endsWith("/") ? imagemBase : `${imagemBase}/`;
  return `${base}bancoImagens/${encodeURI(imagem)}`;
};

const fromFiltros = (imagemBase?: string) => (i: Raw): Credenciado => {
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
    uf: text(end.EstadosUF) ?? text(end.EstadosNome) ?? text(end.Estado),
    cep: text(end.Cep),
    telefone: telefone ? formatPhone(ddd, telefone) : null,
    plantao24h: flag(c.Plantao24h),
    horaMarcada: flag(c.HoraMarcada),
    horarios: horariosLegiveis(i.CredenciadosHorarioAtendimento),
    coberturas: asList(i.CredenciadosCoberturas).map(x => text(x?.CoberturasNome)).filter((x): x is string => !!x),
    avaliacao: text(i.MediaAvaliacoes),
    logo: logoUrl(imagemBase, text(ind.Imagem))
  };
};

// Needs a city or a full CEP; a state alone would list the whole state.
// imagemBase: URL da API da Plamev, para montar o link da logo.
export const buscarCredenciados = async (
  get: PlamevGetter,
  filtros: RedeFiltros,
  imagemBase?: string
): Promise<Credenciado[]> => {
  const cep = (filtros.cep || "").replace(/\D/g, "");
  if (!filtros.cidadeId && cep.length !== 8) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  const data = await get("Credenciados/BuscarCredenciadosFiltros/", {
    Cep: cep || undefined,
    EstadosId: filtros.estadoId || undefined,
    CidadesId: filtros.cidadeId || undefined,
    Bairro: filtros.bairro?.trim() || undefined
  });
  return asList(data).slice(0, MAX_CREDENCIADOS).map(fromFiltros(imagemBase));
};
