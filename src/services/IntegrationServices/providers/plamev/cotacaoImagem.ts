import AppError from "../../../../errors/AppError";
import { formatReais } from "./planoImagem";
import { C, esc, svgParaPng, wrap } from "./redeImagem";

// Imagem (PNG) da cotação simulada para mandar ao cliente: pets e planos,
// mensalidade, primeiro pagamento e fidelidade. Campanha e tabela não aparecem
// (são do vendedor).

export interface CotacaoParaCliente {
  formaPagamento: "cartao" | "boleto";
  pets: { nome: string; especie: "gato" | "cachorro"; plano: string }[];
  primeiraFatura: number | null;
  mensalidade: number | null;
  mesmoValor: boolean;
  semDesconto: number | null; // mensalidade cheia
  fidelidadeAte: string | null; // YYYY-MM-DD
}

const dataBr = (v: string | null): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

export const montarSvgCotacao = (c: CotacaoParaCliente): { svg: string; height: number } => {
  const width = 1080;
  const pad = 48;
  const out: string[] = [];
  let y = pad;

  out.push(`<text x="${pad}" y="${y + 24}" font-size="24" font-weight="bold" fill="${C.brand}" letter-spacing="2">COTAÇÃO PLAMEV</text>`);
  y += 24 + 22;

  c.pets.forEach(p => {
    const linha = `${p.nome} · ${p.especie === "gato" ? "Gato" : "Cachorro"}`;
    wrap(linha, width / 2 - pad, 34, true, 1).forEach(l =>
      out.push(`<text x="${pad}" y="${y + 36}" font-size="34" font-weight="bold" fill="${C.text}">${esc(l)}</text>`)
    );
    out.push(`<text x="${width - pad}" y="${y + 36}" font-size="30" fill="${C.text2}" text-anchor="end">${esc(`Plano ${p.plano}`)}</text>`);
    y += 36 + 18;
  });

  y += 10;
  out.push(`<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="${C.border}" stroke-width="2"/>`);
  y += 28;

  if (c.primeiraFatura) {
    const meio = c.formaPagamento === "cartao" ? "cartão" : "boleto";
    out.push(
      `<text x="${pad}" y="${y + 26}" font-size="26" fill="${C.text2}">${esc(
        c.mesmoValor ? `Mensalidade${c.pets.length > 1 ? " (todos os pets)" : ""}` : "1ª fatura (adesão)"
      )}</text>`
    );
    y += 26 + 8;
    if (c.mesmoValor && c.semDesconto && c.semDesconto > c.primeiraFatura) {
      const de = `de ${formatReais(c.semDesconto)}`;
      out.push(`<text x="${pad}" y="${y + 26}" font-size="26" fill="${C.muted}">${esc(de)}</text>`);
      out.push(`<line x1="${pad + 36}" y1="${y + 17}" x2="${pad + de.length * 26 * 0.5}" y2="${y + 17}" stroke="${C.muted}" stroke-width="2"/>`);
      y += 26 + 8;
    }
    const valor = formatReais(c.primeiraFatura);
    out.push(`<text x="${pad}" y="${y + 64}" font-size="68" font-weight="bold" fill="${C.brand}">${esc(valor)}</text>`);
    out.push(
      `<text x="${pad + valor.length * 68 * 0.5 + 12}" y="${y + 64}" font-size="30" fill="${C.text2}">${esc(
        c.mesmoValor ? `/mês no ${meio}` : `no ${meio}`
      )}</text>`
    );
    y += 64 + 20;
    if (!c.mesmoValor && c.mensalidade) {
      out.push(
        `<text x="${pad}" y="${y + 32}" font-size="30" fill="${C.text}">${esc(`Mensalidade: ${formatReais(c.mensalidade)}/mês`)}</text>`
      );
      y += 32 + 14;
    }
    y += 6;
  }

  const chips = [dataBr(c.fidelidadeAte) ? `Fidelidade até ${dataBr(c.fidelidadeAte)}` : null].filter(Boolean) as string[];
  if (chips.length) {
    y += 6;
    let x = pad;
    chips.forEach(chip => {
      const w = 32 + chip.length * 24 * 0.54;
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="46" rx="12" fill="${C.brandSoft}"/>`);
      out.push(`<text x="${x + 16}" y="${y + 31}" font-size="24" font-weight="bold" fill="${C.brand}">${esc(chip)}</text>`);
      x += w + 12;
    });
    y += 46;
  }

  const height = y + pad;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Liberation Sans"><rect width="${width}" height="${height}" fill="${C.card}"/>${out.join("")}</svg>`;
  return { svg, height };
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

// O navegador manda o resultado que recebeu da simulação: aqui só passa o que a
// imagem usa.
export const cotacaoDaTela = (raw: any): CotacaoParaCliente => ({
  formaPagamento: raw?.formaPagamento === "boleto" ? "boleto" : "cartao",
  pets: (Array.isArray(raw?.pets) ? raw.pets : []).slice(0, 5).map((p: any, i: number) => ({
    nome: str(p?.nome, 40) || `Pet ${i + 1}`,
    especie: p?.especie === "gato" ? "gato" : "cachorro",
    plano: str(p?.plano, 40) || "Plamev"
  })),
  primeiraFatura: num(raw?.primeiraFatura),
  mensalidade: num(raw?.mensalidade),
  mesmoValor: raw?.mesmoValor !== false,
  semDesconto: num(raw?.semDesconto),
  fidelidadeAte: /^\d{4}-\d{2}-\d{2}$/.test(str(raw?.fidelidadeAte, 10)) ? str(raw.fidelidadeAte, 10) : null
});

export const gerarImagemCotacao = (c: CotacaoParaCliente): Buffer => {
  if (!c.pets.length || !c.primeiraFatura) throw new AppError("ERR_INTEGRATION_FILTER_REQUIRED", 400);
  return svgParaPng(montarSvgCotacao(c).svg);
};
