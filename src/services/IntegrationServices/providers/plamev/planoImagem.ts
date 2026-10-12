import AppError from "../../../../errors/AppError";
import { Plano } from "./planos";
import { C, esc, svgParaPng, wrap } from "./redeImagem";

// Imagem (PNG) de um plano da Plamev para mandar ao cliente: o cartão ocupa a
// imagem inteira, como a da rede credenciada.

export const formatReais = (v: number): string =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Largura média por caractere da Liberation Sans (sem medir o texto).
const textWidth = (text: string, size: number, bold = false): number => text.length * size * (bold ? 0.56 : 0.52);

export const montarSvgPlano = (p: Plano): { svg: string; width: number; height: number } => {
  const width = 1080;
  const pad = 48;
  const out: string[] = [];
  let y = pad;

  const badgeW = p.maisVendido ? 40 + textWidth("Mais vendido", 24, true) : 0;
  const nome = wrap(p.nome, width - pad * 2 - (badgeW ? badgeW + 16 : 0), 44, true, 2);
  nome.forEach((line, i) => {
    out.push(`<text x="${pad}" y="${y + 44 + i * 54}" font-size="44" font-weight="bold" fill="${C.text}">${esc(line)}</text>`);
  });
  if (p.maisVendido) {
    const bx = width - pad - badgeW;
    out.push(`<rect x="${bx}" y="${y + 6}" width="${badgeW}" height="42" rx="21" fill="${C.notaBg}"/>`);
    out.push(`<text x="${bx + 20}" y="${y + 35}" font-size="24" font-weight="bold" fill="${C.notaFg}">Mais vendido</text>`);
  }
  y += 44 + (nome.length - 1) * 54 + 16;

  out.push(`<text x="${pad}" y="${y + 26}" font-size="26" fill="${C.text2}">${esc(p.especie)}</text>`);
  y += 26 + 32;

  if (p.precoCartao) {
    if (p.precoCartaoSemDesconto) {
      const de = `de ${formatReais(p.precoCartaoSemDesconto)}`;
      out.push(`<text x="${pad}" y="${y + 26}" font-size="26" fill="${C.muted}">${esc(de)}</text>`);
      out.push(`<line x1="${pad + 36}" y1="${y + 17}" x2="${pad + de.length * 26 * 0.5}" y2="${y + 17}" stroke="${C.muted}" stroke-width="2"/>`);
      y += 26 + 10;
    }
    const preco = formatReais(p.precoCartao);
    out.push(`<text x="${pad}" y="${y + 60}" font-size="64" font-weight="bold" fill="${C.brand}">${esc(preco)}</text>`);
    out.push(
      // Números e "R$" são mais estreitos que a média do texto.
      `<text x="${pad + preco.length * 64 * 0.5 + 12}" y="${y + 60}" font-size="28" fill="${C.text2}">/mês no cartão</text>`
    );
    y += 60 + 22;
  }
  if (p.precoBoleto) {
    out.push(`<text x="${pad}" y="${y + 30}" font-size="28" fill="${C.text2}">${esc(`${formatReais(p.precoBoleto)}/mês no boleto`)}</text>`);
    y += 30 + 22;
  }

  const chips = [
    p.fidelidadeMeses ? `Fidelidade de ${p.fidelidadeMeses} meses` : null,
    p.procedimentos ? `${p.procedimentos} procedimentos cobertos` : null
  ].filter(Boolean) as string[];
  if (chips.length) {
    y += 8;
    let x = pad;
    chips.forEach(chip => {
      const w = 32 + textWidth(chip, 24, true);
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="44" rx="12" fill="${C.brandSoft}"/>`);
      out.push(`<text x="${x + 16}" y="${y + 30}" font-size="24" font-weight="bold" fill="${C.brand}">${esc(chip)}</text>`);
      x += w + 12;
    });
    y += 44;
  }
  const height = y + pad;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Liberation Sans"><rect width="${width}" height="${height}" fill="${C.card}"/>${out.join("")}</svg>`;
  return { svg, width, height };
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// O navegador manda o plano que recebeu da lista: aqui só passa o que a imagem usa.
export const planoDaTela = (raw: any): Plano => ({
  id: str(raw?.id, 64) || "?",
  tipoId: str(raw?.tipoId, 8),
  nome: str(raw?.nome, 60) || "Plano",
  especie: str(raw?.especie, 30) || "Cães e gatos",
  maisVendido: raw?.maisVendido === true,
  precoCartao: num(raw?.precoCartao),
  precoCartaoSemDesconto: num(raw?.precoCartaoSemDesconto),
  precoBoleto: num(raw?.precoBoleto),
  fidelidadeMeses: num(raw?.fidelidadeMeses),
  procedimentos: num(raw?.procedimentos)
});

export const gerarImagemPlano = (plano: Plano | null): Buffer => {
  if (!plano) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return svgParaPng(montarSvgPlano(plano).svg);
};
