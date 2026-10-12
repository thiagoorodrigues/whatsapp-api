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

const semAcento = (v: string): string =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Estado (pela UF) e cidade com credenciados (pelo nome, sem acento) de um endereço.
export const localizarCidade = async (
  get: PlamevGetter,
  endereco: { uf: string; cidade: string }
): Promise<{ estado: Estado | null; cidade: Cidade | null }> => {
  const estado = (await listEstados(get)).find(e => e.uf.toUpperCase() === endereco.uf.toUpperCase()) || null;
  if (!estado) return { estado: null, cidade: null };
  const alvo = semAcento(endereco.cidade);
  const cidade = (await listCidades(get, estado.id)).find(c => semAcento(c.nome) === alvo) || null;
  return { estado, cidade };
};

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
// "08:00" → "08h"; "09:30" → "09h30".
const hora = (v: string): string => (v.endsWith(":00") ? `${v.slice(0, 2)}h` : v.replace(":", "h"));

// Dias em ordem: três ou mais seguidos viram "Seg a Sex"; o resto vai por vírgula.
const rotuloDias = (dias: number[]): string => {
  const partes: string[] = [];
  for (let i = 0; i < dias.length; ) {
    let j = i;
    while (j + 1 < dias.length && dias[j + 1] === dias[j] + 1) j += 1;
    if (j - i >= 2) partes.push(`${DIAS[dias[i]]} a ${DIAS[dias[j]]}`);
    else dias.slice(i, j + 1).forEach(d => partes.push(DIAS[d]));
    i = j + 1;
  }
  return partes.join(", ");
};

// CredenciadosHorarioAtendimento: linhas com dias "1,2,3" (1 = segunda) e um
// horário. Junta os dias que têm o mesmo horário: "Seg, Qua, Sex 08h–20h".
// 00:00 às 00:00 é dia sem atendimento: fica fora.
export const horariosLegiveis = (raw: unknown): string[] => {
  const porHorario = new Map<string, Set<number>>();
  asList(raw).forEach(h => {
    const inicio = hhmm(h?.HorarioInicio);
    const fim = hhmm(h?.HorarioFim);
    if (!inicio || !fim || (inicio === "00:00" && fim === "00:00")) return;
    const chave = `${hora(inicio)}–${hora(fim)}`;
    const dias = porHorario.get(chave) || new Set<number>();
    String(h?.dias ?? "")
      .split(",")
      .map(d => Number(d.trim()))
      .filter(d => DIAS[d])
      .forEach(d => dias.add(d));
    if (dias.size) porHorario.set(chave, dias);
  });
  return [...porHorario.entries()]
    .map(([faixa, dias]) => ({ faixa, dias: [...dias].sort((a, b) => a - b) }))
    .sort((a, b) => a.dias[0] - b.dias[0])
    .map(({ faixa, dias }) => `${rotuloDias(dias)} ${faixa}`);
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
