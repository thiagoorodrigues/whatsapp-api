import AppError from "../../errors/AppError";
import { cacheLayer } from "../../libs/cache";
import { consultarCep } from "../../helpers/consultaCep";
import { credenciadoDaTela, gerarImagemRede } from "./providers/plamev/redeImagem";
import { listPlanos, Plano } from "./providers/plamev/planos";
import { gerarImagemPlano, planoDaTela } from "./providers/plamev/planoImagem";
import { cotacaoDaTela, gerarImagemCotacao } from "./providers/plamev/cotacaoImagem";
import {
  Campanha,
  Especie,
  listCampanhas,
  listRacas,
  listTabelas,
  PedidoCotacao,
  PlamevPoster,
  Raca,
  ResultadoCotacao,
  simularCotacao,
  Tabela
} from "./providers/plamev/cotacao";
import { withSavedToken } from "./CompanyIntegrationService";
import { plamevGet, plamevPost } from "./providers/plamev/client";
import { plamevApiUrl } from "./providers/plamev";
import {
  Bairro,
  buscarCredenciados,
  Cidade,
  Credenciado,
  Estado,
  listBairros,
  listCidades,
  listEstados,
  localizarCidade,
  PlamevGetter,
  RedeFiltros
} from "./providers/plamev/rede";
import { buscarPorProximidade, CredenciadoProximo, Lembrar, RAIO_PADRAO_KM, RAIOS_KM } from "./providers/plamev/proximidade";
import { geocodificarEndereco, PontoGeocodificado } from "../../helpers/geocodificarEndereco";
import { Localidade, sugerirLocalidades } from "../../helpers/localidades";

// The company's token never leaves the server: every call is made here.
const run = <T>(companyId: number, fn: (get: PlamevGetter) => Promise<T>): Promise<T> =>
  withSavedToken(companyId, "plamev", token =>
    fn((path, query) => plamevGet({ apiUrl: plamevApiUrl(), token }, path, query))
  );

// Leitura e escrita (POST) com o token da empresa.
const runPost = <T>(companyId: number, fn: (post: PlamevPoster) => Promise<T>): Promise<T> =>
  withSavedToken(companyId, "plamev", token => fn((path, body) => plamevPost({ apiUrl: plamevApiUrl(), token }, path, body)));

export const estados = (companyId: number): Promise<Estado[]> => run(companyId, listEstados);

export const cidades = async (companyId: number, estadoId: string): Promise<Cidade[]> => {
  if (!estadoId) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return run(companyId, get => listCidades(get, estadoId));
};

export const bairros = async (companyId: number, cidadeId: string): Promise<Bairro[]> => {
  if (!cidadeId) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return run(companyId, get => listBairros(get, cidadeId));
};

// CEP do cliente → cidade dele e, se houver rede lá, a cidade da Plamev (cidadeRede).
export const cep = async (companyId: number, valor: string) => {
  const endereco = await consultarCep(valor);
  if (!endereco) throw new AppError("ERR_CEP_NOT_FOUND", 404);
  const { estado, cidade } = await run(companyId, get => localizarCidade(get, endereco));
  return { ...endereco, estado, cidadeRede: cidade };
};

// Cache no Redis. Fora do ar, a busca segue sem cache em vez de falhar.
const lembrarNoRedis: Lembrar = async function lembrar<T>(chave: string, segundos: number, fn: () => Promise<T>): Promise<T> {
  try {
    const salvo = await cacheLayer.get(chave);
    if (salvo) return JSON.parse(salvo) as T;
  } catch {
    // segue sem cache
  }
  const valor = await fn();
  if (valor !== null && valor !== undefined) {
    cacheLayer.set(chave, JSON.stringify(valor), "EX", segundos).catch(() => undefined);
  }
  return valor;
};

export interface PedidoProximidade {
  // Endereço, bairro, cidade ou CEP, como o atendente digitou.
  endereco?: string;
  // Ponto de uma sugestão do autocomplete (IBGE): dispensa o mapa.
  lat?: number;
  lng?: number;
  raio?: number;
}

// Sugestões do campo de endereço: bairros, distritos e cidades do IBGE, já com o
// ponto. Não passa pela Plamev nem pelo mapa.
export const sugestoesDeLocal = (texto: string): Localidade[] => sugerirLocalidades((texto || "").slice(0, 100), 8);

// Caixa larga em volta do Brasil: barra coordenada trocada ou fora do país.
const noBrasil = (lat: number, lng: number) => lat > -34.5 && lat < 6 && lng > -74.5 && lng < -28;

export interface RespostaProximidade {
  // null: o mapa não achou o endereço.
  origem: PontoGeocodificado | null;
  raio: number;
  ampliado: boolean;
  maisProximas: boolean;
  credenciados: CredenciadoProximo[];
}

const TRINTA_DIAS = 30 * 24 * 60 * 60;

// CEP vira "rua, bairro, cidade - UF" pelo ViaCEP antes de ir ao mapa: o
// OpenStreetMap quase não conhece CEP. CEP inexistente segue como texto.
const textoParaMapa = async (texto: string): Promise<string> => {
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length !== 8 || !/^\s*\d{5}-?\d{3}\s*$/.test(texto)) return texto;
  // ViaCEP fora do ar não pode parar a busca: o CEP segue como texto.
  const end = await consultarCep(digitos).catch(() => null);
  if (!end) return texto;
  return [end.logradouro, end.bairro, `${end.cidade} - ${end.uf}`].filter(Boolean).join(", ");
};

// Credenciados mais perto de um endereço. O ponto vem da sugestão escolhida (IBGE)
// ou, para texto livre, do OpenStreetMap (30 dias de cache por texto); a Plamev
// mede a distância de cada credenciado.
export const proximidade = async (companyId: number, pedido: PedidoProximidade): Promise<RespostaProximidade> => {
  const texto = (pedido.endereco || "").replace(/\s+/g, " ").trim();
  if (texto.length < 3 || texto.length > 200) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  const raio = RAIOS_KM.includes(Number(pedido.raio)) ? Number(pedido.raio) : RAIO_PADRAO_KM;
  const imagemBase = plamevApiUrl();

  return withSavedToken(companyId, "plamev", async token => {
    const opcoes = { apiUrl: plamevApiUrl(), token };
    const get: PlamevGetter = (path, query) => plamevGet(opcoes, path, query);
    const post: PlamevPoster = (path, body) => plamevPost(opcoes, path, body);

    const lat = Number(pedido.lat);
    const lng = Number(pedido.lng);
    let origem: PontoGeocodificado | null;
    if (pedido.lat !== undefined && pedido.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng) && noBrasil(lat, lng)) {
      origem = { lat, lng, rotulo: texto, tipo: "ibge" };
    } else {
      const paraMapa = await textoParaMapa(texto);
      origem = await lembrarNoRedis(`geo:osm:${paraMapa.toLowerCase()}`, TRINTA_DIAS, () => geocodificarEndereco(paraMapa));
    }
    if (!origem) return { origem: null, raio, ampliado: false, maisProximas: false, credenciados: [] };

    const resultado = await buscarPorProximidade(get, post, { origem, raio, imagemBase, lembrar: lembrarNoRedis });
    return { origem, ...resultado };
  });
};

export const credenciados = (companyId: number, filtros: RedeFiltros): Promise<Credenciado[]> =>
  run(companyId, get => buscarCredenciados(get, filtros, plamevApiUrl()));

// PNG com os credenciados escolhidos. Passa pelo token da empresa (só gera
// para quem tem a integração conectada e liberada no plano).
export const imagem = async (companyId: number, body: { credenciados?: unknown }): Promise<Buffer> => {
  const lista = (Array.isArray(body?.credenciados) ? body.credenciados : []).map(credenciadoDaTela);
  return run(companyId, () => gerarImagemRede(lista, { imagemBase: plamevApiUrl() }));
};

// Planos que o site vende no estado do cliente (o preço depende do estado).
export const planos = async (companyId: number, estadoId: string): Promise<Plano[]> => {
  if (!estadoId) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return run(companyId, get => listPlanos(get, estadoId));
};

// PNG de um plano, pelo token da empresa (só com a integração conectada).
export const imagemPlano = async (companyId: number, body: { plano?: unknown }): Promise<Buffer> =>
  run(companyId, async () => gerarImagemPlano(body?.plano ? planoDaTela(body.plano) : null));

export const racas = (companyId: number, especie: string): Promise<Raca[]> =>
  run(companyId, get => listRacas(get, especie as Especie));

export const campanhas = (companyId: number, filtro: { tipoId: string; estadoId: string }): Promise<Campanha[]> =>
  run(companyId, get => listCampanhas(get, filtro));

export const tabelas = (companyId: number, campanhaId: string): Promise<Tabela[]> =>
  run(companyId, get => listTabelas(get, campanhaId));

// Simulação de cotação: não grava nada na Plamev.
export const simular = (companyId: number, pedido: PedidoCotacao): Promise<ResultadoCotacao> =>
  runPost(companyId, post => simularCotacao(post, pedido));

// PNG da cotação simulada (o que o navegador recebeu), pelo token da empresa.
export const imagemCotacao = async (companyId: number, body: { cotacao?: unknown }): Promise<Buffer> =>
  run(companyId, async () => gerarImagemCotacao(cotacaoDaTela(body?.cotacao)));
