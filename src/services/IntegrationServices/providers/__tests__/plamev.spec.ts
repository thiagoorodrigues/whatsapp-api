import { plamevGet } from "../plamev/client";
import { IntegrationError } from "../types";

const reply = (status: number, body = "") => jest.fn(async () => ({ status, ok: status >= 200 && status < 300, text: async () => body }));

describe("plamevGet", () => {
  it("joins the path to the base URL and sends the token as is", async () => {
    const fetchFn = reply(200, "[]");
    await plamevGet({ apiUrl: "https://service.plamev-hm.com/api", token: "abc", fetchFn }, "Estados/consultar");
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe("https://service.plamev-hm.com/api/Estados/consultar");
    expect(init.headers.Authorization).toBe("abc");
  });

  it("adds the query, skipping empty values", async () => {
    const fetchFn = reply(200, "[]");
    await plamevGet({ apiUrl: "https://x.test/", token: "t", fetchFn }, "Credenciados/BuscarCredenciadosFiltros/", {
      Cep: "36015350",
      EstadosId: "",
      CidadesId: undefined,
      Bairro: "Centro"
    });
    expect((fetchFn.mock.calls[0] as any)[0]).toBe("https://x.test/Credenciados/BuscarCredenciadosFiltros/?Cep=36015350&Bairro=Centro");
  });

  it("works with a trailing slash", async () => {
    const fetchFn = reply(200, "[]");
    await plamevGet({ apiUrl: "https://service.plamev-hm.com/", token: "abc", fetchFn }, "Estados/consultar");
    expect((fetchFn.mock.calls[0] as any)[0]).toBe("https://service.plamev-hm.com/Estados/consultar");
  });

  it.each([401, 403])("turns %s into an auth error", async status => {
    await expect(plamevGet({ apiUrl: "https://x.test", token: "bad", fetchFn: reply(status) }, "Estados/consultar"))
      .rejects.toMatchObject({ kind: "auth" });
  });

  it("turns 500 and HTML into unreachable", async () => {
    await expect(plamevGet({ apiUrl: "https://x.test", token: "t", fetchFn: reply(500) }, "a")).rejects.toMatchObject({ kind: "unreachable" });
    await expect(plamevGet({ apiUrl: "https://x.test", token: "t", fetchFn: reply(200, "<html>") }, "a")).rejects.toMatchObject({ kind: "unreachable" });
  });

  it("turns a network failure or timeout into unreachable without leaking the token", async () => {
    const fetchFn = jest.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const err: any = await plamevGet({ apiUrl: "https://x.test", token: "SECRET-TOKEN-XYZ", fetchFn }, "a").catch((e: any) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(err.kind).toBe("unreachable");
    expect(err.message).not.toContain("SECRET-TOKEN-XYZ");
  });
});
