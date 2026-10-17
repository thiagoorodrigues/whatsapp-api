import { geocodificarEndereco, rotuloCurto } from "../geocodificarEndereco";

const reply = (body: unknown, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }));
const rapido = { intervaloMs: 0 };

const savassi = {
  lat: "-19.9372460",
  lon: "-43.9355817",
  addresstype: "neighbourhood",
  display_name: "Savassi, Regional Centro-Sul, Belo Horizonte, Minas Gerais, Região Sudeste, 30140-000, Brasil",
  address: { neighbourhood: "Savassi", city_district: "Regional Centro-Sul", city: "Belo Horizonte", state: "Minas Gerais", postcode: "30140-000" }
};

describe("geocodificarEndereco", () => {
  it("pergunta ao OpenStreetMap só no Brasil, identificado, e devolve o ponto com um rótulo curto", async () => {
    const fetchFn = reply([savassi]);
    expect(await geocodificarEndereco(" Savassi, Belo Horizonte ", { fetchFn, ...rapido })).toEqual({
      lat: -19.937246,
      lng: -43.9355817,
      rotulo: "Savassi, Belo Horizonte, MG",
      tipo: "neighbourhood"
    });
    const [url, init] = fetchFn.mock.calls[0] as any;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(u.searchParams.get("q")).toBe("Savassi, Belo Horizonte");
    expect(u.searchParams.get("countrycodes")).toBe("br");
    expect(init.headers["User-Agent"]).toMatch(/^Wazzy\//);
  });

  it("nada achado ou texto vazio é null", async () => {
    expect(await geocodificarEndereco("Lugar Nenhum", { fetchFn: reply([]), ...rapido })).toBeNull();
    const fetchFn = reply([savassi]);
    expect(await geocodificarEndereco("   ", { fetchFn, ...rapido })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("serviço fora do ar vira ERR_GEOCODER_UNAVAILABLE", async () => {
    await expect(geocodificarEndereco("Savassi", { fetchFn: reply({}, false), ...rapido })).rejects.toMatchObject({ message: "ERR_GEOCODER_UNAVAILABLE", statusCode: 502 });
    const down = jest.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(geocodificarEndereco("Savassi", { fetchFn: down, ...rapido })).rejects.toMatchObject({ message: "ERR_GEOCODER_UNAVAILABLE" });
  });

  it("espera o intervalo entre uma consulta e outra (1 por segundo no Nominatim público)", async () => {
    const fetchFn = reply([savassi]);
    const inicio = Date.now();
    await Promise.all([geocodificarEndereco("a b c", { fetchFn, intervaloMs: 150 }), geocodificarEndereco("d e f", { fetchFn, intervaloMs: 150 })]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(140);
  });

  it("rótulo de rua leva o número e o bairro", () => {
    expect(
      rotuloCurto({ address: { road: "Rua Padre Marinho", house_number: "321", suburb: "Santa Efigênia", city: "Belo Horizonte", state: "Minas Gerais" } })
    ).toBe("Rua Padre Marinho, 321, Santa Efigênia, Belo Horizonte, MG");
  });
});
