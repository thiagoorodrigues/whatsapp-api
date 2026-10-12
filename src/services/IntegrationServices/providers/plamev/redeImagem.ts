import { existsSync } from "fs";
import { Resvg } from "@resvg/resvg-js";
import AppError from "../../../../errors/AppError";
import { Credenciado } from "./rede";

// Imagem (PNG) com os credenciados escolhidos, para mandar ao cliente no
// WhatsApp. Desenhada aqui (e não no navegador) porque as logos da Plamev não
// liberam CORS; a fonte é a Liberation Sans do pdfjs-dist, que existe no
// notebook e no container (o texto não depende das fontes do sistema).

export const MAX_CARTOES = 12;

// Liberation Sans: a do pdfjs-dist (vem com o pdf-parse) ou a do pacote
// fonts-liberation do container; sem nenhuma, as fontes do sistema.
const resolveFont = (file: string): string | null => {
  try {
    return require.resolve(`pdfjs-dist/standard_fonts/${file}`);
  } catch {
    const system = `/usr/share/fonts/truetype/liberation/${file}`;
    return existsSync(system) ? system : null;
  }
};
const FONTS = ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"].map(resolveFont).filter((f): f is string => !!f);
const FONT = "Liberation Sans";

const C = {
  brand: "#0F6E43",
  brandSoft: "#E5F3EB",
  page: "#F3F6F4",
  card: "#FFFFFF",
  border: "#DCE3DF",
  text: "#17201C",
  text2: "#3E4A45",
  muted: "#7A8580",
  notaBg: "#FFF4D6",
  notaFg: "#6A4A00",
  horaBg: "#E3F4F3",
  horaFg: "#0F7373",
  avatar: ["#2E7D6B", "#2F6F75", "#B4262E", "#8A5A00", "#6E45A8", "#0F7373"]
};

const ICON = {
  place: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z",
  phone:
    "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
};

const esc = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Sem medir o texto: largura média por caractere da Liberation Sans.
const wrap = (text: string, maxWidth: number, size: number, bold = false, maxLines = 2): string[] => {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * (bold ? 0.56 : 0.52))));
  const lines: string[] = [];
  let line = "";
  text.split(/\s+/).forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= perLine) line = next;
    else {
      if (line) lines.push(line);
      line = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
    }
  });
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    const last = cut[maxLines - 1];
    cut[maxLines - 1] = `${last.length >= perLine ? last.slice(0, perLine - 1) : last}…`;
    return cut;
  }
  return lines;
};

export const formatNota = (v: string | null): string | null => {
  const n = Number.parseFloat(v || "");
  if (!Number.isFinite(n) || n <= 0) return null;
  return (Math.round(n * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
};

const initials = (nome: string): string =>
  nome
    .split(/\s+/)
    .filter(w => /^[A-Za-zÀ-ÿ]/.test(w) && !/^(dr|dra|de|da|do|dos|das|e)\.?$/i.test(w))
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join("");

const avatarColor = (id: string): string =>
  C.avatar[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % C.avatar.length];

// "Rua A, 1 – Centro, Betim/MG – CEP 32600-050"; sem rua, bairro e cidade.
export const enderecoCompleto = (c: Credenciado): string => {
  const cep = (c.cep || "").replace(/\D/g, "");
  const local = [c.bairro, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(", ");
  return [c.endereco, local, cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : null].filter(Boolean).join(" – ");
};
const placeOf = (c: Credenciado): string => enderecoCompleto(c) || "Endereço não informado";

interface Card {
  height: number;
  draw: (x: number, y: number, height: number) => string;
}

const icon = (path: string, x: number, y: number, size: number, color: string): string =>
  `<path d="${path}" fill="${color}" transform="translate(${x} ${y}) scale(${size / 24})"/>`;

const card = (c: Credenciado, width: number, compact: boolean, logo: string | null): Card => {
  const pad = compact ? 22 : 28;
  const logoSize = compact ? 72 : 96;
  const nameSize = compact ? 25 : 30;
  const size = compact ? 20 : 23;
  const lineH = Math.round(size * 1.45);
  const textX = pad + logoSize + (compact ? 18 : 24);
  const nota = formatNota(c.avaliacao);
  const notaW = nota ? 40 + nota.length * size * 0.62 : 0;
  const textW = width - textX - pad;

  const name = wrap(c.nome, textW - (nota ? notaW + 12 : 0), nameSize, true);
  const place = wrap(placeOf(c), textW - size - 8, size, false, 3);
  const horarios = (c.horarios.length ? c.horarios : ["Horário não informado"]).flatMap(h => wrap(h, textW - size - 8, size, false, 2));
  const badges = [c.horaMarcada && "Hora marcada", c.plantao24h && "Plantão 24h"].filter(Boolean) as string[];
  const planos = c.coberturas.length ? wrap(`Planos: ${c.coberturas.join(", ")}`, textW, size - 3, false, 3) : [];

  let h = pad + name.length * Math.round(nameSize * 1.25) + 10;
  h += place.length * lineH + (c.telefone ? lineH : 0) + horarios.length * lineH;
  if (badges.length) h += 14 + (size + 14);
  if (planos.length) h += 12 + planos.length * Math.round((size - 3) * 1.4);
  h = Math.max(h + pad, logoSize + pad * 2);

  const draw = (x: number, y: number, height: number): string => {
    const out: string[] = [];
    out.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="${C.card}" stroke="${C.border}" stroke-width="2"/>`);
    const lx = x + pad;
    const ly = y + pad;
    if (logo) {
      const clip = `clip-${c.id.replace(/[^A-Za-z0-9]/g, "")}`;
      out.push(`<clipPath id="${clip}"><rect x="${lx}" y="${ly}" width="${logoSize}" height="${logoSize}" rx="16"/></clipPath>`);
      out.push(`<rect x="${lx}" y="${ly}" width="${logoSize}" height="${logoSize}" rx="16" fill="#FFFFFF" stroke="${C.border}" stroke-width="2"/>`);
      out.push(
        `<image href="${logo}" x="${lx + 4}" y="${ly + 4}" width="${logoSize - 8}" height="${logoSize - 8}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clip})"/>`
      );
    } else {
      const color = avatarColor(c.id);
      out.push(`<rect x="${lx}" y="${ly}" width="${logoSize}" height="${logoSize}" rx="16" fill="${color}" fill-opacity="0.14"/>`);
      out.push(
        `<text x="${lx + logoSize / 2}" y="${ly + logoSize / 2 + logoSize * 0.13}" font-size="${Math.round(logoSize * 0.36)}" font-weight="bold" fill="${color}" text-anchor="middle">${esc(initials(c.nome))}</text>`
      );
    }

    const tx = x + textX;
    let ty = y + pad + nameSize - 4;
    name.forEach((line, i) => {
      out.push(`<text x="${tx}" y="${ty + i * Math.round(nameSize * 1.25)}" font-size="${nameSize}" font-weight="bold" fill="${C.text}">${esc(line)}</text>`);
    });
    if (nota) {
      const nx = x + width - pad - notaW;
      const ny = y + pad - 2;
      const pillH = size + 14;
      out.push(`<rect x="${nx}" y="${ny}" width="${notaW}" height="${pillH}" rx="${pillH / 2}" fill="${C.notaBg}"/>`);
      out.push(icon(ICON.star, nx + 10, ny + (pillH - size) / 2, size, "#E0A100"));
      out.push(`<text x="${nx + 16 + size}" y="${ny + pillH / 2 + size * 0.36}" font-size="${size}" font-weight="bold" fill="${C.notaFg}">${esc(nota)}</text>`);
    }
    ty += (name.length - 1) * Math.round(nameSize * 1.25) + 10;

    const row = (path: string | null, lines: string[], color = C.text2, bold = false) => {
      lines.forEach((line, i) => {
        ty += lineH;
        if (path && i === 0) out.push(icon(path, tx, ty - size + 2, size, C.muted));
        out.push(
          `<text x="${tx + size + 8}" y="${ty}" font-size="${size}"${bold ? ' font-weight="bold"' : ""} fill="${color}">${esc(line)}</text>`
        );
      });
    };
    row(ICON.place, place);
    if (c.telefone) row(ICON.phone, [c.telefone], C.text, true);
    row(ICON.clock, horarios, c.horarios.length ? C.text2 : C.muted);

    if (badges.length) {
      ty += 14;
      let bx = tx;
      badges.forEach(b => {
        const bw = 24 + b.length * size * 0.56;
        const hora = b === "Hora marcada";
        out.push(`<rect x="${bx}" y="${ty}" width="${bw}" height="${size + 14}" rx="10" fill="${hora ? C.horaBg : C.brandSoft}"/>`);
        out.push(
          `<text x="${bx + 12}" y="${ty + (size + 14) / 2 + size * 0.36}" font-size="${size}" font-weight="bold" fill="${hora ? C.horaFg : C.brand}">${esc(b)}</text>`
        );
        bx += bw + 10;
      });
      ty += size + 14;
    }
    if (planos.length) {
      ty += 12;
      planos.forEach(line => {
        ty += Math.round((size - 3) * 1.4);
        out.push(`<text x="${tx}" y="${ty - 4}" font-size="${size - 3}" fill="${C.muted}">${esc(line)}</text>`);
      });
    }
    return out.join("");
  };
  return { height: h, draw };
};

export interface SvgRede {
  svg: string;
  width: number;
  height: number;
  columns: number;
}

// logos: id do credenciado → data URI.
export const montarSvgRede = (credenciados: Credenciado[], { logos }: { logos: Map<string, string | null> }): SvgRede => {
  const width = 1080;
  const margin = 40;
  const gap = 24;
  const columns = credenciados.length > 3 ? 2 : 1;
  const colW = (width - margin * 2 - gap * (columns - 1)) / columns;
  const cards = credenciados.map(c => card(c, colW, columns === 2, logos.get(c.id) || null));

  // Só os cartões: sem cabeçalho nem rodapé (a legenda da mensagem explica).
  const parts: string[] = [];
  let y = margin;
  for (let i = 0; i < cards.length; i += columns) {
    const rowCards = cards.slice(i, i + columns);
    const rowH = Math.max(...rowCards.map(k => k.height));
    rowCards.forEach((k, j) => parts.push(k.draw(margin + j * (colW + gap), y, rowH)));
    y += rowH + gap;
  }
  const height = y - gap + margin;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}"><rect width="${width}" height="${height}" fill="${C.page}"/>${parts.join("")}</svg>`;
  return { svg, width, height, columns };
};

type FetchFn = (url: string, init?: Record<string, any>) => Promise<any>;

// Só baixa do bancoImagens da própria Plamev: a lista vem do navegador e a api
// não pode buscar qualquer URL que mandarem.
const baixarLogo = async (url: string | null, imagemBase: string, fetchFn: FetchFn): Promise<string | null> => {
  const base = imagemBase.endsWith("/") ? imagemBase : `${imagemBase}/`;
  if (!url || !url.startsWith(`${base}bancoImagens/`)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    const type = String(res.headers?.get?.("content-type") || "").split(";")[0].trim();
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strs = (v: unknown, maxItems: number, max: number): string[] =>
  (Array.isArray(v) ? v : []).map(x => str(x, max)).filter((x): x is string => !!x).slice(0, maxItems);

// O navegador manda os credenciados que já recebeu da busca: aqui só passa o
// que a imagem usa, com tamanho limitado.
export const credenciadoDaTela = (raw: any): Credenciado => ({
  id: str(raw?.id, 64) || "?",
  nome: str(raw?.nome, 120) || "Credenciado",
  endereco: str(raw?.endereco, 160) || "",
  bairro: str(raw?.bairro, 80),
  cidade: str(raw?.cidade, 80),
  uf: str(raw?.uf, 30),
  cep: str(raw?.cep, 12),
  telefone: str(raw?.telefone, 30),
  plantao24h: raw?.plantao24h === true,
  horaMarcada: raw?.horaMarcada === true,
  horarios: strs(raw?.horarios, 7, 60),
  coberturas: strs(raw?.coberturas, 15, 40),
  avaliacao: str(raw?.avaliacao, 8),
  logo: str(raw?.logo, 1000)
});

export const gerarImagemRede = async (
  credenciados: Credenciado[],
  { imagemBase, fetchFn = (globalThis as any).fetch }: { imagemBase: string; fetchFn?: FetchFn }
): Promise<Buffer> => {
  if (!credenciados.length) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  if (credenciados.length > MAX_CARTOES) throw new AppError("ERR_PLAMEV_IMAGE_TOO_MANY", 400);
  const baixadas = await Promise.all(credenciados.map(c => baixarLogo(c.logo, imagemBase, fetchFn)));
  const logos = new Map(credenciados.map((c, i) => [c.id, baixadas[i]]));
  const { svg } = montarSvgRede(credenciados, { logos });
  const resvg = new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: FONTS.length < 2, defaultFontFamily: FONT },
    fitTo: { mode: "width", value: 1080 }
  });
  return resvg.render().asPng();
};
