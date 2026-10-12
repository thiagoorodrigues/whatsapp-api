import AppError from "../../errors/AppError";
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

export const credenciados = (companyId: number, filtros: RedeFiltros): Promise<Credenciado[]> =>
  run(companyId, get => buscarCredenciados(get, filtros, plamevApiUrl()));
