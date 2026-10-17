#!/usr/bin/env node
// Gera src/data/localidades-br.json: os bairros oficiais e as sedes dos municípios
// do Brasil com latitude e longitude, a partir dos arquivos públicos do IBGE.
//
//   node scripts/gerar-localidades-ibge.mjs                 baixa os arquivos do IBGE
//   node scripts/gerar-localidades-ibge.mjs --pasta /tmp/x  usa (ou guarda) os arquivos em /tmp/x
//
// Fontes:
// - Malha de Bairros do Censo 2022 (BR_bairros_CD2022.gpkg): só bairros instituídos
//   por lei municipal. São Paulo, Goiânia, Campinas, Contagem e o DF não têm nenhum.
// - Localidades do Brasil 2022: o ponto da sede de cada município e, para cobrir
//   parte do que falta, as sedes de distrito (os 96 distritos de São Paulo: Moema,
//   Pinheiros...) e as Regiões Administrativas do DF (Taguatinga, Ceilândia...).
// - API de localidades: nome oficial e UF de todos os municípios.
// Precisa de Node 22.5+ (node:sqlite) e do unzip do sistema.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

// Mesmo ajuste do server.ts: em rede sem IPv6, 250 ms por tentativa não conecta.
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAIDA = path.join(RAIZ, "src/data/localidades-br.json");

const URL_BAIRROS =
  "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/gpkg/BR/BR_bairros_CD2022.gpkg";
const URL_LOCALIDADES =
  "https://geoftp.ibge.gov.br/organizacao_do_territorio/estrutura_territorial/localidades/Localidades_do_Brasil/2022/Localidades_Brasil_gpkg.zip";
const URL_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
const URL_ESTADOS = "https://servicodados.ibge.gov.br/api/v1/localidades/estados";

const arg = nome => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const pasta = arg("--pasta") || path.join(tmpdir(), "localidades-ibge");
mkdirSync(pasta, { recursive: true });

const baixar = async (url, destino) => {
  if (existsSync(destino)) return destino;
  console.log(`baixando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  return destino;
};
const json = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

// --- geometria do GeoPackage -------------------------------------------------

// Cabeçalho GP (8 bytes + envelope) seguido de WKB. Devolve os polígonos como
// listas de anéis [[x, y], ...]; o primeiro anel é o contorno, os outros, buracos.
const TAMANHO_ENVELOPE = [0, 32, 48, 48, 64];
const lerPoligonos = blob => {
  const buf = Buffer.from(blob);
  if (buf[0] !== 0x47 || buf[1] !== 0x50) throw new Error("geometria sem cabeçalho GP");
  const flags = buf[3];
  let pos = 8 + TAMANHO_ENVELOPE[(flags >> 1) & 0x07];
  const poligonos = [];
  const lerGeometria = () => {
    const le = buf[pos] === 1;
    pos += 1;
    const u32 = () => {
      const v = le ? buf.readUInt32LE(pos) : buf.readUInt32BE(pos);
      pos += 4;
      return v;
    };
    const f64 = () => {
      const v = le ? buf.readDoubleLE(pos) : buf.readDoubleBE(pos);
      pos += 8;
      return v;
    };
    const bruto = u32();
    const tipo = bruto % 1000;
    // 1003 = Z, 2003 = M, 3003 = ZM: as coordenadas extras são lidas e ignoradas.
    const dims = [2, 3, 3, 4][Math.floor(bruto / 1000)] ?? 2;
    if (tipo === 3) {
      const aneis = [];
      for (let r = u32(); r > 0; r -= 1) {
        const anel = [];
        for (let n = u32(); n > 0; n -= 1) {
          const x = f64();
          const y = f64();
          for (let d = 2; d < dims; d += 1) f64();
          anel.push([x, y]);
        }
        aneis.push(anel);
      }
      poligonos.push(aneis);
    } else if (tipo === 6 || tipo === 7) {
      for (let g = u32(); g > 0; g -= 1) lerGeometria();
    } else {
      throw new Error(`tipo de geometria não suportado: ${tipo}`);
    }
  };
  lerGeometria();
  return poligonos;
};

const areaAnel = anel => {
  let a = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i, i += 1) a += (anel[j][0] + anel[i][0]) * (anel[j][1] - anel[i][1]);
  return Math.abs(a / 2);
};

const dentroDoAnel = ([x, y], anel) => {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i, i += 1) {
    const [xi, yi] = anel[i];
    const [xj, yj] = anel[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
};
const dentroDoPoligono = (p, aneis) => dentroDoAnel(p, aneis[0]) && !aneis.slice(1).some(b => dentroDoAnel(p, b));

const centroide = anel => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i, i += 1) {
    const f = anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    a += f;
    cx += (anel[j][0] + anel[i][0]) * f;
    cy += (anel[j][1] + anel[i][1]) * f;
  }
  return a === 0 ? anel[0] : [cx / (3 * a), cy / (3 * a)];
};

// Ponto garantidamente dentro do bairro: o centroide do maior polígono quando ele
// cai dentro; senão o meio do trecho mais largo de uma linha horizontal que
// atravessa o polígono (bairro em "L" ou em "U" tem centroide do lado de fora).
const pontoInterno = poligonos => {
  const aneis = poligonos.reduce((maior, p) => (areaAnel(p[0]) > areaAnel(maior[0]) ? p : maior));
  const c = centroide(aneis[0]);
  if (dentroDoPoligono(c, aneis)) return c;
  const ys = aneis[0].map(p => p[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let melhor = null;
  for (const frac of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = minY + (maxY - minY) * frac;
    const xs = [];
    aneis.forEach(anel => {
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i, i += 1) {
        const [xi, yi] = anel[i];
        const [xj, yj] = anel[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    });
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const largura = xs[k + 1] - xs[k];
      if (!melhor || largura > melhor.largura) melhor = { largura, ponto: [(xs[k] + xs[k + 1]) / 2, y] };
    }
    if (melhor) break;
  }
  return melhor ? melhor.ponto : c;
};

const arred = v => Math.round(v * 1e5) / 1e5; // ~1 m

// --- montagem ----------------------------------------------------------------

const main = async () => {
  const arqBairros = await baixar(URL_BAIRROS, path.join(pasta, "BR_bairros_CD2022.gpkg"));
  const zip = await baixar(URL_LOCALIDADES, path.join(pasta, "Localidades_Brasil_gpkg.zip"));
  const arqLocalidades = path.join(pasta, "BR_localidades_2022.gpkg");
  if (!existsSync(arqLocalidades)) execFileSync("unzip", ["-o", "-q", "-j", zip, "*.gpkg", "-d", pasta]);

  const estados = (await json(URL_ESTADOS)).map(e => ({ sigla: e.sigla, nome: e.nome })).sort((a, b) => a.sigla.localeCompare(b.sigla));
  const municipios = (await json(URL_MUNICIPIOS)).map(m => ({
    ibge: String(m.id),
    nome: m.nome,
    uf: m.microrregiao?.mesorregiao?.UF?.sigla ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla
  }));

  // Sedes municipais: um ponto por município (o arquivo repete algumas linhas).
  // Brasília é "Capital Federal" e Fernando de Noronha, "Distrito Estadual".
  const loc = new DatabaseSync(arqLocalidades, { readOnly: true });
  const sedes = new Map();
  const sqlSedes = `SELECT CD_MUN, LAT_LOCALIDADE AS lat, LONG_LOCALIDADE AS lng FROM BR_localidades_2022
    WHERE SCT_LOCALIDADE IN ('Sede Municipal', 'Capital Federal') OR CT_LOCALIDADE = 'Distrito Estadual de Fernando de Noronha'`;
  for (const r of loc.prepare(sqlSedes).all()) {
    if (!sedes.has(r.CD_MUN)) sedes.set(r.CD_MUN, [Number(r.lat), Number(r.lng)]);
  }
  // "Vila" é a sede de um distrito; as RAs do DF fazem papel de bairro em Brasília.
  const sqlDistritos = `SELECT CD_MUN, NM_MUN, NM_LOCALIDADE AS nome, LAT_LOCALIDADE AS lat, LONG_LOCALIDADE AS lng FROM BR_localidades_2022
    WHERE CT_LOCALIDADE IN ('Vila', 'Regiões Administrativas do Distrito Federal')`;
  const distritos = loc.prepare(sqlDistritos).all();
  loc.close();

  // Bairros: junta os polígonos do mesmo bairro e acha um ponto dentro dele.
  const db = new DatabaseSync(arqBairros, { readOnly: true });
  const porBairro = new Map();
  for (const r of db.prepare("SELECT CD_BAIRRO, NM_BAIRRO, CD_MUN, geom FROM BR_bairros_CD2022").all()) {
    const atual = porBairro.get(r.CD_BAIRRO) || { nome: r.NM_BAIRRO.trim(), mun: r.CD_MUN, poligonos: [] };
    atual.poligonos.push(...lerPoligonos(r.geom));
    porBairro.set(r.CD_BAIRRO, atual);
  }
  db.close();

  // Município sem sede no arquivo (Brasília, Fernando de Noronha...): o centro dos
  // bairros dele, se houver.
  const pontosBairros = new Map();
  const bairrosSaida = [];
  for (const b of porBairro.values()) {
    const [lng, lat] = pontoInterno(b.poligonos);
    bairrosSaida.push({ nome: b.nome, mun: b.mun, lat, lng });
    const lista = pontosBairros.get(b.mun) || [];
    lista.push([lat, lng]);
    pontosBairros.set(b.mun, lista);
  }

  const semPonto = [];
  const cidades = municipios
    .map(m => {
      let ponto = sedes.get(m.ibge);
      if (!ponto && pontosBairros.has(m.ibge)) {
        const l = pontosBairros.get(m.ibge);
        ponto = [l.reduce((s, p) => s + p[0], 0) / l.length, l.reduce((s, p) => s + p[1], 0) / l.length];
      }
      if (!ponto) semPonto.push(`${m.nome}/${m.uf}`);
      return ponto ? { ...m, lat: ponto[0], lng: ponto[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome, "pt-BR"));

  // Distritos e RAs entram como lugares da cidade, sem repetir o nome dela nem um
  // bairro oficial de mesmo nome.
  const chave = (mun, nome) => `${mun}|${nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()}`;
  const vistos = new Set(bairrosSaida.map(b => chave(b.mun, b.nome)));
  let extras = 0;
  distritos.forEach(d => {
    const nome = String(d.nome || "").trim();
    if (!nome || chave(d.CD_MUN, nome) === chave(d.CD_MUN, d.NM_MUN) || vistos.has(chave(d.CD_MUN, nome))) return;
    vistos.add(chave(d.CD_MUN, nome));
    bairrosSaida.push({ nome, mun: d.CD_MUN, lat: Number(d.lat), lng: Number(d.lng) });
    extras += 1;
  });

  const indice = new Map(cidades.map((c, i) => [c.ibge, i]));
  const bairros = bairrosSaida
    .filter(b => indice.has(b.mun))
    .sort((a, b) => indice.get(a.mun) - indice.get(b.mun) || a.nome.localeCompare(b.nome, "pt-BR"))
    .map(b => [b.nome, indice.get(b.mun), arred(b.lat), arred(b.lng)]);

  const saida = {
    fonte: "IBGE: Malha de Bairros do Censo 2022, Localidades do Brasil 2022 e API de localidades",
    gerado: new Date().toISOString().slice(0, 10),
    // [sigla, nome]
    estados: estados.map(e => [e.sigla, e.nome]),
    // [nome, uf, lat, lng, código IBGE]
    cidades: cidades.map(c => [c.nome, c.uf, arred(c.lat), arred(c.lng), Number(c.ibge)]),
    // [nome, índice da cidade, lat, lng]: bairros oficiais, distritos e RAs do DF
    bairros
  };
  mkdirSync(path.dirname(SAIDA), { recursive: true });
  writeFileSync(SAIDA, `${JSON.stringify(saida)}\n`);
  console.log(
    `${estados.length} estados, ${cidades.length} cidades, ${bairros.length} lugares (${bairros.length - extras} bairros oficiais + ${extras} distritos/RAs) → ${path.relative(RAIZ, SAIDA)}`
  );
  if (semPonto.length) console.log(`sem ponto (ficaram de fora): ${semPonto.join(", ")}`);
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
