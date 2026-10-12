import AppError from "../../errors/AppError";
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
