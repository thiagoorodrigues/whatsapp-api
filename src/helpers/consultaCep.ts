import AppError from "../errors/AppError";

export interface EnderecoCep {
  cep: string;
  cidade: string;
  uf: string;
  bairro: string | null;
}

type FetchFn = (url: string, init?: Record<string, any>) => Promise<any>;

// Cidade, UF e bairro de um CEP (ViaCEP, público e sem chave). null quando o
// CEP está incompleto ou não existe; ERR_CEP_UNAVAILABLE quando o serviço falha.
export const consultarCep = async (
  cep: string,
  fetchFn: FetchFn = (globalThis as any).fetch,
  timeoutMs = 8000
): Promise<EnderecoCep | null> => {
  const digits = (cep || "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data: any;
  try {
    const res = await fetchFn(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal });
    if (!res.ok) throw new Error(`ViaCEP ${res.status}`);
    data = await res.json();
  } catch {
    throw new AppError("ERR_CEP_UNAVAILABLE", 502);
  } finally {
    clearTimeout(timer);
  }
  if (!data || data.erro || !data.localidade || !data.uf) return null;
  const bairro = typeof data.bairro === "string" && data.bairro.trim() ? data.bairro.trim() : null;
  return { cep: digits, cidade: String(data.localidade), uf: String(data.uf), bairro };
};
