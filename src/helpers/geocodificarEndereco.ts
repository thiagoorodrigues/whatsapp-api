import AppError from "../errors/AppError";

export interface PontoGeocodificado {
  lat: number;
  lng: number;
  // O que o mapa entendeu ("Savassi, Belo Horizonte, MG"), para o atendente conferir.
  rotulo: string;
  // Tipo do lugar no OpenStreetMap: neighbourhood, suburb, road, city...
  tipo: string | null;
}

type FetchFn = (url: string, init?: Record<string, any>) => Promise<any>;

// Nominatim público do OpenStreetMap. A política de uso pede no máximo 1 consulta
// por segundo, identificação no User-Agent e cache; quem tiver instância própria
// aponta NOMINATIM_URL para ela.
const nominatimUrl = (): string => (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const USER_AGENT = "Wazzy/1.0 (+https://chat.wazzy.com.br)";
const INTERVALO_MS = 1100;

// Fila de um por vez no processo, com o intervalo mínimo entre as consultas.
let fila: Promise<unknown> = Promise.resolve();
let ultima = 0;
const naVez = <T>(fn: () => Promise<T>, intervaloMs: number): Promise<T> => {
  const vez = fila.then(async () => {
    const espera = ultima + intervaloMs - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultima = Date.now();
    return fn();
  });
  fila = vez.catch(() => undefined);
  return vez;
};

// "Savassi, Regional Centro-Sul, Belo Horizonte, Região Geográfica..., Minas
// Gerais, Região Sudeste, 30140-000, Brasil" → "Savassi, Belo Horizonte, MG".
const UF: Record<string, string> = {
  Acre: "AC", Alagoas: "AL", Amapá: "AP", Amazonas: "AM", Bahia: "BA", Ceará: "CE", "Distrito Federal": "DF",
  "Espírito Santo": "ES", Goiás: "GO", Maranhão: "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG", Pará: "PA", Paraíba: "PB", Paraná: "PR", Pernambuco: "PE", Piauí: "PI",
  "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS", Rondônia: "RO",
  Roraima: "RR", "Santa Catarina": "SC", "São Paulo": "SP", Sergipe: "SE", Tocantins: "TO"
};
export const rotuloCurto = (item: any): string => {
  const a = item?.address ?? {};
  const lugar = a.road ? [a.road, a.house_number].filter(Boolean).join(", ") : null;
  const bairro = a.neighbourhood || a.suburb || a.quarter || a.city_district || null;
  const cidade = a.city || a.town || a.village || a.municipality || null;
  const uf = UF[a.state] || a.state || null;
  const partes = [lugar, bairro, cidade, uf].filter((v, i, all) => v && all.indexOf(v) === i);
  return partes.length ? partes.join(", ") : String(item?.display_name ?? "").split(",").slice(0, 3).join(",").trim();
};

// Texto livre (endereço, bairro, cidade) → ponto no mapa, só no Brasil. null quando
// o mapa não acha; ERR_GEOCODER_UNAVAILABLE quando o serviço falha.
export const geocodificarEndereco = async (
  texto: string,
  { fetchFn = (globalThis as any).fetch, timeoutMs = 8000, intervaloMs = INTERVALO_MS }: { fetchFn?: FetchFn; timeoutMs?: number; intervaloMs?: number } = {}
): Promise<PontoGeocodificado | null> => {
  const q = (texto || "").trim();
  if (!q) return null;
  const url = `${nominatimUrl()}/search?${new URLSearchParams({
    q,
    format: "jsonv2",
    countrycodes: "br",
    addressdetails: "1",
    limit: "1",
    "accept-language": "pt-BR"
  })}`;

  const data: any = await naVez(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: controller.signal });
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      return await res.json();
    } catch {
      throw new AppError("ERR_GEOCODER_UNAVAILABLE", 502);
    } finally {
      clearTimeout(timer);
    }
  }, intervaloMs);

  const item = Array.isArray(data) ? data[0] : null;
  const lat = Number.parseFloat(item?.lat);
  const lng = Number.parseFloat(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, rotulo: rotuloCurto(item), tipo: item?.addresstype ?? item?.type ?? null };
};
