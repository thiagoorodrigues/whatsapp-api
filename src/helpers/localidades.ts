import fs from "fs";
import path from "path";

// Bairros, distritos e cidades do Brasil com coordenada, gerados do IBGE por
// scripts/gerar-localidades-ibge.mjs. Serve o autocomplete do endereço: a sugestão
// já traz o ponto, sem consultar mapa nenhum.

export interface Localidade {
  tipo: "bairro" | "cidade";
  nome: string;
  cidade: string;
  uf: string;
  lat: number;
  lng: number;
  // "Savassi, Belo Horizonte/MG" ou "Belo Horizonte/MG": o que vai no campo.
  rotulo: string;
}

interface Entrada extends Localidade {
  palavrasNome: string[];
  palavrasLocal: string[];
  chaveNome: string;
  // Lugares cadastrados na cidade: desempata "belo" a favor de Belo Horizonte.
  peso: number;
}

type Dados = { cidades: [string, string, number, number, number][]; bairros: [string, number, number, number][] };

export const normalizar = (v: string): string =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const palavras = (v: string): string[] => normalizar(v).split(" ").filter(Boolean);

// src/helpers → src/data (testes e ts-node); dist/helpers → dist/data (build com a
// cópia da pasta); dist/helpers → src/data (HM, que compila só com tsc).
const CAMINHOS = ["../data/localidades-br.json", "../../src/data/localidades-br.json"];

let cache: Entrada[] | null = null;

export const montarIndice = (dados: Dados): Entrada[] => {
  const pesos = new Map<number, number>();
  dados.bairros.forEach(([, i]) => pesos.set(i, (pesos.get(i) || 0) + 1));
  const cidades: Entrada[] = dados.cidades.map(([nome, uf, lat, lng], i) => ({
    tipo: "cidade",
    nome,
    cidade: nome,
    uf,
    lat,
    lng,
    rotulo: `${nome}/${uf}`,
    palavrasNome: palavras(nome),
    palavrasLocal: [uf.toLowerCase()],
    chaveNome: normalizar(nome),
    peso: pesos.get(i) || 0
  }));
  const bairros: Entrada[] = dados.bairros
    .filter(([, i]) => cidades[i])
    .map(([nome, i, lat, lng]) => {
      const c = cidades[i];
      return {
        tipo: "bairro",
        nome,
        cidade: c.nome,
        uf: c.uf,
        lat,
        lng,
        rotulo: `${nome}, ${c.nome}/${c.uf}`,
        palavrasNome: palavras(nome),
        palavrasLocal: [...c.palavrasNome, c.uf.toLowerCase()],
        chaveNome: normalizar(nome),
        peso: c.peso
      };
    });
  return [...cidades, ...bairros];
};

const indice = (): Entrada[] => {
  if (cache) return cache;
  const arquivo = CAMINHOS.map(c => path.resolve(__dirname, c)).find(c => fs.existsSync(c));
  cache = arquivo ? montarIndice(JSON.parse(fs.readFileSync(arquivo, "utf8"))) : [];
  return cache;
};

const comeca = (lista: string[], token: string) => lista.some(p => p.startsWith(token));

// "sava", "savassi bel", "centro, sete lagoas", "pinheiros sp". A primeira palavra
// tem de começar uma palavra do nome; as outras podem casar com o nome, a cidade
// ou a UF. Nome que começa com o texto vem antes; empate: cidade antes de bairro,
// depois a cidade com mais lugares cadastrados.
// Sem bairro que case ("centro, sete lagoas" numa cidade sem bairro oficial),
// sugere a cidade escrita no fim do texto.
export const sugerirLocalidades = (texto: string, limite = 8, entradas: Entrada[] = indice()): Localidade[] => {
  const tokens = palavras(texto);
  if (!tokens.length || tokens.join("").length < 2) return [];
  const [primeiro, ...resto] = tokens;

  const achados: { e: Entrada; nota: number }[] = [];
  for (const e of entradas) {
    if (!comeca(e.palavrasNome, primeiro)) continue;
    if (!resto.every(t => comeca(e.palavrasNome, t) || comeca(e.palavrasLocal, t))) continue;
    // 0: o nome começa pelo que foi digitado e não sobra palavra ("pinheiros sp" →
    // Pinheiros); 0,5: começa mas sobra (Pinheiros do Sul); 1: casa no meio
    // (Jardim Pinheiros).
    let usadas = 0;
    while (usadas < tokens.length && e.palavrasNome[usadas]?.startsWith(tokens[usadas])) usadas += 1;
    let nota = usadas === 0 ? 1 : usadas >= e.palavrasNome.length ? 0 : 0.5;
    if (e.tipo === "cidade") nota -= 0.25;
    achados.push({ e, nota });
  }

  if (!achados.length && tokens.length > 1) {
    // O fim do texto como cidade: o trecho depois da última vírgula, ou as últimas
    // 1 a 3 palavras.
    const virgula = texto.lastIndexOf(",");
    const finais = virgula >= 0 ? [palavras(texto.slice(virgula + 1))] : [1, 2, 3].map(n => tokens.slice(-n)).filter(f => f.length < tokens.length);
    for (const e of entradas) {
      if (e.tipo !== "cidade") continue;
      const casa = finais.some(f => f.length && comeca(e.palavrasNome, f[0]) && f.every(t => comeca(e.palavrasNome, t) || comeca(e.palavrasLocal, t)));
      if (casa) achados.push({ e, nota: 2 });
    }
  }

  achados.sort(
    (a, b) => a.nota - b.nota || b.e.peso - a.e.peso || a.e.nome.length - b.e.nome.length || a.e.rotulo.localeCompare(b.e.rotulo, "pt-BR")
  );
  return achados.slice(0, limite).map(({ e }) => ({
    tipo: e.tipo,
    nome: e.nome,
    cidade: e.cidade,
    uf: e.uf,
    lat: e.lat,
    lng: e.lng,
    rotulo: e.rotulo
  }));
};
