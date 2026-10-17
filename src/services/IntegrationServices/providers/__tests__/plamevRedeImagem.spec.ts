import { enderecoCompleto, gerarImagemRede, montarSvgRede, MAX_CARTOES } from "../plamev/redeImagem";
import { Credenciado } from "../plamev/rede";

const BASE = "https://service.plamev-hm.com/";

const vet = (id: string, extra: Partial<Credenciado> = {}): Credenciado => ({
  id,
  nome: `Clínica ${id} & Cia`,
  endereco: "Rua A, 1",
  bairro: "Centro",
  cidade: "Betim",
  uf: "MG",
  cep: "32600050",
  telefone: "(31) 99710-4439",
  plantao24h: false,
  horaMarcada: true,
  horarios: ["Seg a Sex 08h–18h"],
  coberturas: ["Slim", "Advance"],
  avaliacao: "4.79",
  logo: null,
  ...extra
});

describe("montarSvgRede", () => {
  it("draws each credenciado with escaped text, rating, hours and badges", () => {
    const { svg, width } = montarSvgRede([vet("k1")], { logos: new Map() });
    expect(width).toBe(1080);
    expect(svg).toContain("Clínica k1 &amp; Cia");
    expect(svg).toContain("4,8");
    expect(svg).toContain("Seg a Sex 08h–18h");
    expect(svg).toContain("Hora marcada");
    expect(svg).toContain("Rua A, 1 – Centro, Betim/MG – CEP 32600-050");
    expect(svg).not.toContain("Rede credenciada");
    expect(svg).not.toContain("plamevpets");
    // Os planos aceitos não vão para o cliente.
    expect(svg).not.toContain("Planos");
    expect(svg).not.toContain("Advance");
    // Sem logo: as iniciais.
    expect(svg).toContain(">CK<");
  });

  it("draws a single credenciado without the gray frame or the card border", () => {
    const solo = montarSvgRede([vet("k1")], { logos: new Map() });
    expect(solo.svg).not.toContain("#F3F6F4");
    expect(solo.svg).not.toContain('stroke="#DCE3DF" stroke-width="2"/><clipPath');
    expect(solo.svg).toMatch(/^<svg[^>]*><rect width="1080" height="\d+" fill="#FFFFFF"\/><rect x="0" y="0"/);
    const varios = montarSvgRede([vet("a"), vet("b")], { logos: new Map() });
    expect(varios.svg).toContain('fill="#F3F6F4"');
    expect(varios.svg).toContain('rx="20"');
  });

  it("uses two columns above three credenciados", () => {
    const um = montarSvgRede([vet("a"), vet("b"), vet("c")], { logos: new Map() });
    const dois = montarSvgRede([vet("a"), vet("b"), vet("c"), vet("d")], { logos: new Map() });
    expect(dois.height).toBeLessThan(um.height + 200);
    expect(dois.columns).toBe(2);
    expect(um.columns).toBe(1);
  });

  it("embeds the logo when it was downloaded", () => {
    const { svg } = montarSvgRede([vet("k1")], { logos: new Map([["k1", "data:image/jpeg;base64,AAAA"]]) });
    expect(svg).toContain('href="data:image/jpeg;base64,AAAA"');
    expect(svg).not.toContain(">CK<");
  });
});

describe("enderecoCompleto", () => {
  it("joins street, neighborhood, city/UF and CEP, skipping what is missing", () => {
    expect(enderecoCompleto(vet("k1"))).toBe("Rua A, 1 – Centro, Betim/MG – CEP 32600-050");
    expect(enderecoCompleto(vet("k2", { endereco: "", bairro: null, cep: null }))).toBe("Betim/MG");
  });
});

describe("gerarImagemRede", () => {
  const jpeg = () => ({ ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });

  it("returns a PNG and only downloads logos from the Plamev bancoImagens", async () => {
    const fetchFn = jest.fn(async () => jpeg());
    const png = await gerarImagemRede(
      [vet("k1", { logo: `${BASE}bancoImagens/abc` }), vet("k2", { logo: "http://169.254.169.254/latest/meta-data" })],
      { imagemBase: BASE, fetchFn }
    );
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0] as any)[0]).toBe(`${BASE}bancoImagens/abc`);
  });

  it("still draws the card when a logo fails to download", async () => {
    const fetchFn = jest.fn(async () => { throw new Error("timeout"); });
    const png = await gerarImagemRede([vet("k1", { logo: `${BASE}bancoImagens/abc` })], { imagemBase: BASE, fetchFn });
    expect(png.length).toBeGreaterThan(1000);
  });

  it("refuses an empty selection or more than MAX_CARTOES", async () => {
    await expect(gerarImagemRede([], { imagemBase: BASE })).rejects.toMatchObject({ message: "ERR_INTEGRATION_FILTER_REQUIRED" });
    const many = Array.from({ length: MAX_CARTOES + 1 }, (_, i) => vet(String(i)));
    await expect(gerarImagemRede(many, { imagemBase: BASE })).rejects.toMatchObject({ message: "ERR_PLAMEV_IMAGE_TOO_MANY" });
  });
});
