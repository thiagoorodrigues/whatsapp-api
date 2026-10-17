import { consultarCep } from "../consultaCep";

const reply = (body: unknown, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));

describe("consultarCep", () => {
  it("returns city, state, neighborhood and street of a CEP", async () => {
    const fetchFn = reply({ cep: "32600-000", localidade: "Betim", uf: "MG", bairro: "", logradouro: "" });
    expect(await consultarCep("32600-000", fetchFn)).toEqual({ cep: "32600000", cidade: "Betim", uf: "MG", bairro: null, logradouro: null });
    const rua = reply({ localidade: "Belo Horizonte", uf: "MG", bairro: "Santa Efigênia", logradouro: "Rua Padre Marinho" });
    expect(await consultarCep("30140040", rua)).toMatchObject({ bairro: "Santa Efigênia", logradouro: "Rua Padre Marinho" });
    expect((fetchFn.mock.calls[0] as any)[0]).toBe("https://viacep.com.br/ws/32600000/json/");
  });

  it("returns null for an incomplete or unknown CEP", async () => {
    const fetchFn = reply({ erro: true });
    expect(await consultarCep("1234", fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await consultarCep("99999999", fetchFn)).toBeNull();
  });

  it("fails with ERR_CEP_UNAVAILABLE when the service is down", async () => {
    await expect(consultarCep("32600000", reply({}, false))).rejects.toMatchObject({ message: "ERR_CEP_UNAVAILABLE", statusCode: 502 });
    const down = jest.fn(async () => { throw new Error("ECONNRESET"); });
    await expect(consultarCep("32600000", down)).rejects.toMatchObject({ message: "ERR_CEP_UNAVAILABLE" });
  });
});
