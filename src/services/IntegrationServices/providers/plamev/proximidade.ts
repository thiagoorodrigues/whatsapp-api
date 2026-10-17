import { IntegrationError } from "../types";
import { PlamevPoster } from "./cotacao";
import { asList, Credenciado, formatPhone, fromFiltros, MAX_CREDENCIADOS, PlamevGetter, text } from "./rede";

// Busca por proximidade, como a página da rede da Plamev: o ponto de partida vem
// do endereço que o atendente digita, e a Plamev devolve cada credenciado com a
// distância em linha reta até ele.

// Raios que o atendente escolhe. Quando o pedido vem magro, o resultado sobe
// para o próximo degrau até o teto, e a tela diz que ampliou.
export const RAIOS_KM = [3, 5, 10, 20, 30, 40];
export const RAIO_PADRAO_KM = 5;
export const TETO_KM = 40;
// Menos que isto no raio pedido é "magro".
export const MINIMO_NO_RAIO = 3;
// Nada até o teto: procura mais longe, um degrau por vez, e mostra as mais
// próximas. Há praças sem rede a mais de 1.500 km (Oiapoque → Fortaleza); cada
// degrau vazio custa ~1 s, e o último volta grande (~900 KB), por isso só no fim.
export const RAIOS_LONGE_KM = [500, 2000, 5000];
export const QUANTAS_MAIS_PROXIMAS = 5;

// Guarda o resultado de fn por `segundos`. O serviço liga isto ao Redis; os testes
// passam uma função que só executa.
export type Lembrar = <T>(chave: string, segundos: number, fn: () => Promise<T>) => Promise<T>;

export interface Ponto {
  lat: number;
  lng: number;
}

export type CredenciadoProximo = Credenciado & { distanciaKm: number };

const UMA_HORA = 60 * 60;

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

// A lista da cidade é pesada (BH: ~8 s, 1,5 MB) e muda pouco: uma hora de cache.
// Guarda já mapeada, sem o JSON cru da Plamev.
export const credenciadosDaCidade = (
  get: PlamevGetter,
  cidadeId: string,
  imagemBase: string | undefined,
  lembrar: Lembrar
): Promise<Credenciado[]> =>
  lembrar(`plamev:rede:cidade:v2:${cidadeId}`, UMA_HORA, async () =>
    asList(await get("Credenciados/BuscarCredenciadosFiltros/", { CidadesId: cidadeId })).map(fromFiltros(imagemBase))
  );

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
  // Nada até o teto: são as QUANTAS_MAIS_PROXIMAS mais perto, fora do raio.
  maisProximas: boolean;
}

type Achado = { curto: Record<string, any>; distancia: number };

// "Nada no raio" a Plamev responde como erro 400; para nós é lista vazia.
const consultar = async (post: PlamevPoster, origem: Ponto, raio: number): Promise<Achado[]> => {
  let data: unknown;
  try {
    data = await post("Credenciados/BuscaCredenciados", { Lat: origem.lat, Lng: origem.lng, Raio: raio });
  } catch (err) {
    if (err instanceof IntegrationError && /nenhum parceiro/i.test(err.message)) return [];
    throw err;
  }
  return asList(data)
    .map(i => ({ curto: i?.Credenciados ?? {}, distancia: numero(i?.DistanciaLinhaReta) ?? 0 }))
    .filter(i => i.curto.Id)
    .sort((a, b) => a.distancia - b.distancia);
};

// Uma consulta no teto: o recorte pelo raio pedido e a ampliação são feitos aqui,
// sem uma ida à Plamev por degrau. Vazio até o teto, uma segunda consulta bem mais
// longe traz as mais próximas. Os dados completos (horário, coberturas, nota,
// logo) vêm da lista de cada cidade do resultado, que fica em cache.
export const buscarPorProximidade = async (
  get: PlamevGetter,
  post: PlamevPoster,
  { origem, raio, imagemBase, lembrar }: { origem: Ponto; raio: number; imagemBase?: string; lembrar: Lembrar }
): Promise<ResultadoProximidade> => {
  const achados = await consultar(post, origem, TETO_KM);

  let escolhidos: Achado[];
  let resumo: { raio: number; ampliado: boolean; maisProximas: boolean };
  if (achados.length) {
    const escolha = escolherRaio(
      achados.map(a => a.distancia),
      raio
    );
    escolhidos = achados.filter(a => a.distancia <= escolha.raio).slice(0, MAX_CREDENCIADOS);
    resumo = { ...escolha, maisProximas: false };
  } else {
    escolhidos = [];
    for (const longe of RAIOS_LONGE_KM) {
      // eslint-disable-next-line no-await-in-loop
      escolhidos = (await consultar(post, origem, longe)).slice(0, QUANTAS_MAIS_PROXIMAS);
      if (escolhidos.length) break;
    }
    resumo = { raio, ampliado: false, maisProximas: escolhidos.length > 0 };
  }

  const cidades = [...new Set(escolhidos.map(a => String(a.curto.CidadesId || "")).filter(Boolean))];
  const completos = new Map<string, Credenciado>();
  const listas = await Promise.all(cidades.map(id => credenciadosDaCidade(get, id, imagemBase, lembrar)));
  listas.flat().forEach(c => completos.set(c.id, c));

  return {
    ...resumo,
    credenciados: escolhidos.map(a => ({
      ...(completos.get(String(a.curto.Id)) ?? doFormatoCurto(a.curto)),
      distanciaKm: Math.round(a.distancia * 10) / 10
    }))
  };
};
