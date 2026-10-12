import AppError from "../../errors/AppError";
import { consultarCep } from "../../helpers/consultaCep";
import { credenciadoDaTela, gerarImagemRede } from "./providers/plamev/redeImagem";
import { withSavedToken } from "./CompanyIntegrationService";
import { plamevGet } from "./providers/plamev/client";
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
export const imagem = async (companyId: number, body: { credenciados?: unknown; titulo?: unknown }): Promise<Buffer> => {
  const lista = (Array.isArray(body?.credenciados) ? body.credenciados : []).map(credenciadoDaTela);
  const titulo = typeof body?.titulo === "string" ? body.titulo.trim().slice(0, 80) : "";
  return run(companyId, () => gerarImagemRede(lista, { titulo, imagemBase: plamevApiUrl() }));
};
