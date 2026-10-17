import { IntegrationError } from "../types";
import { PlamevPoster } from "./cotacao";
import { asList, Credenciado, formatPhone, fromFiltros, MAX_CREDENCIADOS, PlamevGetter, semAcento, text } from "./rede";

// Busca por proximidade, como a página da rede da Plamev: o ponto de partida é o
// centro de um bairro, e a Plamev devolve cada credenciado com a distância em
// linha reta até ele.

// Raios que o atendente escolhe. Quando o pedido vem magro, o resultado sobe
// para o próximo degrau até o teto, e a tela diz que ampliou.
export const RAIOS_KM = [3, 5, 10, 20, 30, 40];
export const RAIO_PADRAO_KM = 5;
export const TETO_KM = 40;
// Menos que isto no raio pedido é "magro".
export const MINIMO_NO_RAIO = 3;

// Guarda o resultado de fn por `segundos`. O serviço liga isto ao Redis; os testes
// passam uma função que só executa.
export type Lembrar = <T>(chave: string, segundos: number, fn: () => Promise<T>) => Promise<T>;

export interface Ponto {
  lat: number;
  lng: number;
}

export interface Origem extends Ponto {
  // credenciados: média das clínicas do bairro; mapa: geocoder da Plamev (Google).
  fonte: "credenciados" | "mapa";
  rotulo: string;
}

// distanciaKm null: a busca caiu para a lista do bairro, sem ponto de partida.
export type CredenciadoProximo = Credenciado & { distanciaKm: number | null };

// Credenciado da cidade com a coordenada do endereço (quando a Plamev divulga).
export interface CredenciadoLocalizado {
  credenciado: Credenciado;
  ponto: Ponto | null;
}

const UMA_HORA = 60 * 60;
const TRINTA_DIAS = 30 * 24 * UMA_HORA;

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

const pontoDe = (lat: unknown, lng: unknown): Ponto | null => {
  const la = numero(lat);
  const lo = numero(lng);
  return la !== null && lo !== null ? { lat: la, lng: lo } : null;
};

// A lista da cidade é pesada (BH: ~8 s, 1,5 MB) e muda pouco: uma hora de cache.
// Guarda já mapeada, sem o JSON cru da Plamev.
export const credenciadosDaCidade = (
  get: PlamevGetter,
  cidadeId: string,
  imagemBase: string | undefined,
  lembrar: Lembrar
): Promise<CredenciadoLocalizado[]> =>
  lembrar(`plamev:rede:cidade:${cidadeId}`, UMA_HORA, async () =>
    asList(await get("Credenciados/BuscarCredenciadosFiltros/", { CidadesId: cidadeId })).map(raw => {
      const end = Array.isArray(raw.IndividuosEnderecos) ? raw.IndividuosEnderecos[0] ?? {} : raw.IndividuosEnderecos ?? {};
      return { credenciado: fromFiltros(imagemBase)(raw), ponto: pontoDe(end.Latitude, end.Longitude) };
    })
  );

// Centro do bairro = média das clínicas dele que têm endereço público. Não gasta
// geocoder; falha só onde nenhuma clínica do bairro divulga o endereço.
export const centroDoBairro = (lista: CredenciadoLocalizado[], bairro: string): (Ponto & { n: number }) | null => {
  const alvo = semAcento(bairro);
  const pontos = lista
    .filter(l => l.ponto && semAcento(l.credenciado.bairro || "") === alvo)
    .map(l => l.ponto as Ponto);
  if (!pontos.length) return null;
  const soma = pontos.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: soma.lat / pontos.length, lng: soma.lng / pontos.length, n: pontos.length };
};

// Plano B: o geocoder da Plamev. Cada acerto é uma chamada PAGA ao Google, por isso
// 30 dias de cache por texto. Falha (endereço não achado ou token sem permissão
// nesta rota) vira null: quem chama cai para a lista do bairro.
export const geocodificar = async (get: PlamevGetter, endereco: string, lembrar: Lembrar): Promise<Origem | null> => {
  const chave = `plamev:rede:geo:${semAcento(endereco).replace(/\s+/g, " ")}`;
  try {
    return await lembrar(chave, TRINTA_DIAS, async () => {
      const data: any = await get("Cidades/ConsultarCoordenadasEndereco", { Endereco: endereco });
      const ponto = pontoDe(data?.Lat, data?.Lng);
      if (!ponto) throw new IntegrationError("unreachable", "Endereço não localizado.");
      const rotulo = String(text(data?.Rotulo) ?? endereco)
        .replace(/,?\s*\d{5}-?\d{3}/g, "")
        .replace(/,?\s*(Brazil|Brasil)\s*$/i, "")
        .trim();
      return { ...ponto, fonte: "mapa" as const, rotulo: rotulo || endereco };
    });
  } catch (err) {
    if (err instanceof IntegrationError && err.kind !== "auth") return null;
    throw err;
  }
};

// Distâncias já em ordem. Fica no raio pedido se ele tem o mínimo; senão sobe até o
// primeiro degrau que tenha, parando no teto.
export const escolherRaio = (distancias: number[], pedido: number): { raio: number; ampliado: boolean } => {
  const dentro = (r: number) => distancias.filter(d => d <= r).length;
  if (dentro(pedido) >= MINIMO_NO_RAIO) return { raio: pedido, ampliado: false };
  const proximo = RAIOS_KM.find(r => r > pedido && r <= TETO_KM && dentro(r) >= MINIMO_NO_RAIO);
  if (proximo) return { raio: proximo, ampliado: true };
  // Nem o teto chega ao mínimo: mostra o que houver nele.
  return dentro(TETO_KM) > dentro(pedido) ? { raio: TETO_KM, ampliado: true } : { raio: pedido, ampliado: false };
};

// Credenciado no formato curto do BuscaCredenciados, quando ele não aparece na
// lista da cidade (não deveria acontecer: as duas são a vitrine do site).
const doFormatoCurto = (c: Record<string, any>): Credenciado => {
  const telefone = text(c.Telefone);
  return {
    id: String(c.Id),
    nome: text(c.NomeFantasia) ?? text(c.NomeCredenciado) ?? text(c.Nome) ?? "",
    endereco: [text(c.Logradouro), text(c.Numero)].filter(Boolean).join(", "),
    bairro: text(c.Bairro),
    cidade: text(c.Cidade),
    uf: null,
    cep: text(c.Cep),
    telefone: telefone ? formatPhone(text(c.Ddd), telefone) : null,
    plantao24h: false,
    horaMarcada: false,
    horarios: [],
    coberturas: [],
    avaliacao: null,
    logo: null
  };
};

export interface ResultadoProximidade {
  credenciados: CredenciadoProximo[];
  raio: number;
  ampliado: boolean;
}

// Uma consulta só, já no teto: o recorte pelo raio pedido e a ampliação são feitos
// aqui, sem uma ida à Plamev por degrau. Os dados completos (horário, coberturas,
// nota, logo) vêm da lista de cada cidade do resultado, que fica em cache.
export const buscarPorProximidade = async (
  get: PlamevGetter,
  post: PlamevPoster,
  { origem, raio, imagemBase, lembrar }: { origem: Ponto; raio: number; imagemBase?: string; lembrar: Lembrar }
): Promise<ResultadoProximidade> => {
  let data: unknown;
  try {
    data = await post("Credenciados/BuscaCredenciados", { Lat: origem.lat, Lng: origem.lng, Raio: TETO_KM });
  } catch (err) {
    // A Plamev responde "nada no raio" como erro 400; para nós é lista vazia.
    if (err instanceof IntegrationError && /nenhum parceiro/i.test(err.message)) data = [];
    else throw err;
  }

  const achados = asList(data)
    .map(i => ({ curto: i?.Credenciados ?? {}, distancia: numero(i?.DistanciaLinhaReta) ?? 0 }))
    .filter(i => i.curto.Id)
    .sort((a, b) => a.distancia - b.distancia);

  const escolha = escolherRaio(
    achados.map(a => a.distancia),
    raio
  );
  const dentro = achados.filter(a => a.distancia <= escolha.raio).slice(0, MAX_CREDENCIADOS);

  const cidades = [...new Set(dentro.map(a => String(a.curto.CidadesId || "")).filter(Boolean))];
  const completos = new Map<string, Credenciado>();
  const listas = await Promise.all(cidades.map(id => credenciadosDaCidade(get, id, imagemBase, lembrar)));
  listas.flat().forEach(l => completos.set(l.credenciado.id, l.credenciado));

  return {
    ...escolha,
    credenciados: dentro.map(a => ({
      ...(completos.get(String(a.curto.Id)) ?? doFormatoCurto(a.curto)),
      distanciaKm: Math.round(a.distancia * 10) / 10
    }))
  };
};
