import dns from "dns";
import {
  callHttpTool,
  fillContext,
  httpToolDefinitions,
  isPrivateAddress,
  sanitizeHttpTools,
  serializeHttpTools,
  toolNameOf
} from "../httpTools";
import { buildToolSet } from "../tools";

const raw = {
  name: "Consultar pedido",
  description: "Busca o status de um pedido pelo número",
  method: "GET",
  url: "https://api.loja.com/pedidos/{numero}?cliente={{contato.numero}}",
  headers: [{ key: "Authorization", value: "Bearer segredo" }],
  params: [
    { name: "numero", type: "string", description: "Número do pedido", required: true },
    { name: "detalhado", type: "boolean", description: "", required: false }
  ]
};

const fetchMock = jest.fn();

beforeAll(() => {
  process.env.SECRETS_KEY = "test-secrets-key";
  (globalThis as any).fetch = fetchMock;
});

beforeEach(() => {
  fetchMock.mockReset();
  jest.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
});

afterEach(() => jest.restoreAllMocks());

const ok = (body: string, status = 200) => ({ status, text: async () => body });

describe("sanitizeHttpTools", () => {
  it("encrypts header values and masks them for clients", () => {
    const [tool] = sanitizeHttpTools([raw]);
    expect(tool.headers[0].valueEncrypted).toBeTruthy();
    expect(JSON.stringify(tool)).not.toContain("segredo");
    expect(serializeHttpTools([tool])[0].headers).toEqual([{ key: "Authorization", hasValue: true }]);
  });

  it("keeps the stored header value when the editor sends it blank", () => {
    const [saved] = sanitizeHttpTools([raw]);
    const [again] = sanitizeHttpTools([{ ...raw, id: saved.id, headers: [{ key: "Authorization", value: "" }] }], [saved]);
    expect(again.headers[0].valueEncrypted).toBe(saved.headers[0].valueEncrypted);
  });

  it("rejects bad settings", () => {
    expect(() => sanitizeHttpTools([{ ...raw, url: "ftp://x.com" }])).toThrow("ERR_AI_HTTP_TOOL_INVALID");
    expect(() => sanitizeHttpTools([{ ...raw, description: "" }])).toThrow("ERR_AI_HTTP_TOOL_INVALID");
    expect(() => sanitizeHttpTools([raw, { ...raw }])).toThrow("nome repetido");
    expect(() => sanitizeHttpTools([{ ...raw, params: [{ name: "1x" }] }])).toThrow("parâmetro inválido");
    expect(() => sanitizeHttpTools([{ ...raw, headers: [{ key: "Host", value: "a" }] }])).toThrow("cabeçalho");
  });
});

describe("definitions", () => {
  it("exposes the declared parameters as JSON Schema", () => {
    const [def] = httpToolDefinitions(sanitizeHttpTools([raw]));
    expect(def.name).toBe("http_consultar_pedido");
    expect(def.parameters.required).toEqual(["numero"]);
    expect(Object.keys(def.parameters.properties)).toEqual(["numero", "detalhado"]);
  });

  it("names tools without accents", () => {
    expect(toolNameOf({ name: "Emissão de 2ª via" })).toBe("http_emissao_de_2_via");
  });
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.0.10", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"])(
    "blocks %s",
    ip => expect(isPrivateAddress(ip)).toBe(true)
  );
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700::1111"])("allows %s", ip => expect(isPrivateAddress(ip)).toBe(false));
});

describe("callHttpTool", () => {
  const ctx = { contactName: "Ana", contactNumber: "5511988887777", ticketId: 9 };

  it("fills path params, context and query, with the stored headers", async () => {
    fetchMock.mockResolvedValue(ok('{"status":"enviado"}'));
    const [tool] = sanitizeHttpTools([raw]);
    const result = await callHttpTool(tool, { numero: "A 1", detalhado: true }, ctx);
    expect(result).toEqual({ ok: true, status: 200, body: '{"status":"enviado"}' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.loja.com/pedidos/A%201?cliente=5511988887777&detalhado=true");
    expect(init.headers.Authorization).toBe("Bearer segredo");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBeUndefined();
  });

  it("sends the remaining arguments as JSON on POST", async () => {
    fetchMock.mockResolvedValue(ok("criado", 201));
    const [tool] = sanitizeHttpTools([{ ...raw, method: "POST", url: "https://api.loja.com/pedidos" }]);
    await callHttpTool(tool, { numero: "7" }, ctx);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ numero: "7" });
  });

  it("refuses internal addresses", async () => {
    (dns.promises.lookup as jest.Mock).mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const [tool] = sanitizeHttpTools([raw]);
    const result = await callHttpTool(tool, { numero: "1" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.body).toContain("endereço interno");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing required params without calling", async () => {
    const [tool] = sanitizeHttpTools([raw]);
    expect((await callHttpTool(tool, {}, ctx)).body).toContain("numero");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cuts long responses and says how big they were", async () => {
    fetchMock.mockResolvedValue(ok("x".repeat(30000)));
    const [tool] = sanitizeHttpTools([raw]);
    const { body } = await callHttpTool(tool, { numero: "1" }, ctx);
    expect(body.length).toBeLessThan(20200);
    expect(body).toContain("de 30000 caracteres");
  });

  it("runs through the tool set and flags HTTP errors", async () => {
    fetchMock.mockResolvedValue(ok("não encontrado", 404));
    const set = buildToolSet({ http: sanitizeHttpTools([raw]) }, { queues: [], http: ctx });
    expect(set.definitions.map(d => d.name)).toEqual(["http_consultar_pedido"]);
    expect(await set.execute("http_consultar_pedido", { numero: "1" })).toEqual({
      result: "HTTP 404\nnão encontrado",
      error: true
    });
  });
});

describe("fillContext", () => {
  it("replaces known variables and blanks unknown ones", () => {
    expect(fillContext("{{contato.nome}}-{{ticket.id}}-{{outro}}", { contactName: "Ana", ticketId: 3 })).toBe("Ana-3-");
  });
});

describe("JSON body template", () => {
  const ctx = { contactName: "Ana", contactNumber: "5511988887777", ticketId: 9 };
  const template = {
    Nome: "{{nome completo do tutor}}",
    Email: "{{email?}}",
    Site: 1,
    Ativo: true,
    Codigo: "abc",
    Telefone: "{{contato.numero}}",
    Endereco: { Cep: "{{cep}}" },
    CotacoesPets: [{ Nome: "{{pet_nome}}", Idade: "{{pet_idade:numero?}}", Origem: 2 }],
    Tags: ["{{etiqueta?}}"],
    Canais: ["site", "zap"],
    Extra: null
  };
  const quote = {
    name: "Cotar",
    description: "Faz a cotação do plano pet",
    method: "POST",
    url: "https://api.pet.com/cotacoes",
    params: [],
    bodyTemplate: JSON.stringify(template, null, 2)
  };

  it("keeps the template and offers the model only the {{fields}} it fills", () => {
    const [tool] = sanitizeHttpTools([quote]);
    expect(tool.bodyTemplate).toBe(quote.bodyTemplate);
    const [def] = httpToolDefinitions([tool]);
    const props = def.parameters.properties as any;
    expect(Object.keys(props)).toEqual(["Nome", "Email", "Endereco", "CotacoesPets", "Tags"]);
    expect(def.parameters.required).toEqual(["Nome", "Endereco", "CotacoesPets"]);
    expect(props.Nome).toEqual({ type: "string", description: "nome completo do tutor" });
    expect(props.CotacoesPets.items.properties.Idade).toEqual({ type: "number", description: "pet idade" });
    expect(props.CotacoesPets.items.required).toEqual(["Nome"]);
    expect(props.Tags).toMatchObject({ type: "array", items: { type: "string" } });
  });

  it("builds the body with fixed values, context and lists", async () => {
    fetchMock.mockResolvedValue(ok("{}", 201));
    const [tool] = sanitizeHttpTools([quote]);
    const result = await callHttpTool(
      tool,
      { Nome: "Ana", Endereco: { Cep: "01000-000" }, CotacoesPets: [{ Nome: "Rex", Idade: "3" }, { Nome: "Mia" }] },
      ctx
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      Nome: "Ana",
      Site: 1,
      Ativo: true,
      Codigo: "abc",
      Telefone: "5511988887777",
      Endereco: { Cep: "01000-000" },
      CotacoesPets: [
        { Nome: "Rex", Idade: 3, Origem: 2 },
        { Nome: "Mia", Origem: 2 }
      ],
      Canais: ["site", "zap"],
      Extra: null
    });
  });

  it("accepts lists sent as JSON text", async () => {
    fetchMock.mockResolvedValue(ok("{}"));
    const [tool] = sanitizeHttpTools([quote]);
    await callHttpTool(tool, { Nome: "Ana", Endereco: { Cep: "1" }, CotacoesPets: '[{"Nome":"Rex"}]' }, ctx);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).CotacoesPets).toEqual([{ Nome: "Rex", Origem: 2 }]);
  });

  it("reports every missing required field without calling", async () => {
    const [tool] = sanitizeHttpTools([quote]);
    const result = await callHttpTool(tool, { Nome: "Ana", CotacoesPets: [{ Idade: 2 }] }, ctx);
    expect(result.ok).toBe(false);
    expect(result.body).toContain("Endereco.Cep");
    expect(result.body).toContain("CotacoesPets[0].Nome");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects bad templates", () => {
    const withTemplate = (body: unknown, extra = {}) =>
      sanitizeHttpTools([{ ...quote, ...extra, bodyTemplate: typeof body === "string" ? body : JSON.stringify(body) }]);
    expect(() => withTemplate("{ nao é json")).toThrow("JSON inválido");
    expect(() => withTemplate([1])).toThrow("objeto JSON");
    expect(() => withTemplate({ "a b": "{{x}}" })).toThrow("campo inválido");
    expect(() => withTemplate({ a: "Olá {{nome}}" })).toThrow("valor inteiro");
    expect(() => withTemplate({ a: ["{{x}}", "{{y}}"] })).toThrow("um item");
    expect(() => withTemplate({ numero: "{{n}}" }, { params: [{ name: "numero" }] })).toThrow("já é um parâmetro");
  });

  it("drops the template on GET and keeps tools without one as before", () => {
    expect(sanitizeHttpTools([{ ...quote, method: "GET" }])[0].bodyTemplate).toBe("");
    expect(sanitizeHttpTools([{ ...quote, bodyTemplate: "  " }])[0].body).toEqual([]);
  });
});

describe("JSON request (URL, query, headers, timeout)", () => {
  const ctx = { contactName: "Ana", contactNumber: "5511988887777", ticketId: 9 };
  const tool = {
    name: "Consultar pedido",
    description: "Busca um pedido",
    method: "GET",
    url: "https://api.loja.com/pedidos/{{numero do pedido}}?origem=wazzy",
    timeout: 25,
    headers: [{ key: "Authorization", value: "Bearer {{contato.numero}}" }],
    queryTemplate: JSON.stringify({ cliente: "{{contato.numero}}", detalhado: "{{detalhado:simnao?}}", limite: 10 }),
    params: []
  };

  it("offers URL and query fields to the model", () => {
    const [saved] = sanitizeHttpTools([tool]);
    expect(saved.timeout).toBe(25);
    const [def] = httpToolDefinitions([saved]);
    expect(def.parameters.properties).toEqual({
      numero_do_pedido: { type: "string", description: "numero do pedido" },
      detalhado: { type: "boolean", description: "detalhado" }
    });
    expect(def.parameters.required).toEqual(["numero_do_pedido"]);
  });

  it("fills URL, query and headers", async () => {
    fetchMock.mockResolvedValue(ok("{}"));
    const [saved] = sanitizeHttpTools([tool]);
    await callHttpTool(saved, { numero_do_pedido: "A 1", detalhado: true }, ctx);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.loja.com/pedidos/A%201?origem=wazzy&cliente=5511988887777&detalhado=true&limite=10");
    expect(init.headers.Authorization).toBe("Bearer 5511988887777");
  });

  it("reports a missing URL field without calling", async () => {
    const [saved] = sanitizeHttpTools([tool]);
    expect((await callHttpTool(saved, {}, ctx)).body).toContain("numero_do_pedido");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates timeout, query and headers", () => {
    expect(sanitizeHttpTools([{ ...tool, timeout: 999 }])[0].timeout).toBe(60);
    expect(sanitizeHttpTools([{ ...tool, timeout: undefined }])[0].timeout).toBe(10);
    expect(() => sanitizeHttpTools([{ ...tool, queryTemplate: '{"a":{"b":1}}' }])).toThrow("valores simples");
    expect(() => sanitizeHttpTools([{ ...tool, headers: [{ key: "X", value: "{{token}}" }] }])).toThrow("cabeçalho");
    expect(() =>
      sanitizeHttpTools([{ ...tool, queryTemplate: '{"numero_do_pedido":"{{x}}"}' }])
    ).toThrow("repetido");
  });
});

describe("response filter", () => {
  const ctx = { contactName: "Ana", contactNumber: "5511988887777", ticketId: 9 };
  const response = {
    Coberturas: [
      { Id: "A", Nome: "SLIM", Imagem: "x".repeat(500), Valores: [{ PlanosValor: "59.99", PlanosId: "p" }], Boleto: { Composicao: { ValorTotal: 59.99, Pets: [] } } },
      { Id: "B", Nome: "ADVANCE", Valores: [], Boleto: { Composicao: { ValorTotal: 149.99 } } }
    ],
    ProcedimentosSite: [{ Id: "1", Nome: "VACINA" }],
    Carencia: { "1": { Nome: "CONSULTA", Id: "c1" }, "2": { Nome: "TAXA", Id: "c2" } }
  };
  const tool = (responseTemplate: string) =>
    sanitizeHttpTools([{ name: "Cotar", description: "Cota", method: "GET", url: "https://api.pet.com/c", responseTemplate }])[0];

  it("keeps only the fields of the template, for every item", async () => {
    fetchMock.mockResolvedValue(ok(JSON.stringify(response, null, 4)));
    const filter = JSON.stringify({
      Coberturas: [{ Nome: true, Valores: [{ PlanosValor: true }], Boleto: { Composicao: { ValorTotal: true } } }],
      Carencia: [{ Nome: true }]
    });
    const { body } = await callHttpTool(tool(filter), {}, ctx);
    expect(JSON.parse(body)).toEqual({
      Coberturas: [
        { Nome: "SLIM", Valores: [{ PlanosValor: "59.99" }], Boleto: { Composicao: { ValorTotal: 59.99 } } },
        { Nome: "ADVANCE", Valores: [], Boleto: { Composicao: { ValorTotal: 149.99 } } }
      ],
      Carencia: { "1": { Nome: "CONSULTA" }, "2": { Nome: "TAXA" } }
    });
  });

  it("compacts JSON and keeps the whole response without a filter", async () => {
    fetchMock.mockResolvedValue(ok('{\n    "Nome": "PADR\\u00c3O"\n}'));
    expect((await callHttpTool(tool(""), {}, ctx)).body).toBe('{"Nome":"PADRÃO"}');
  });

  it("passes non-JSON responses through", async () => {
    fetchMock.mockResolvedValue(ok("tudo certo"));
    expect((await callHttpTool(tool('{"a":true}'), {}, ctx)).body).toBe("tudo certo");
  });

  it("rejects an invalid filter", () => {
    expect(() => tool("{ nada")).toThrow("JSON inválido");
  });
});
