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

  it("cuts long responses", async () => {
    fetchMock.mockResolvedValue(ok("x".repeat(10000)));
    const [tool] = sanitizeHttpTools([raw]);
    expect((await callHttpTool(tool, { numero: "1" }, ctx)).body.length).toBeLessThan(4100);
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
