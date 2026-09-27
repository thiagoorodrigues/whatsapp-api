import { buildToolSet } from "../tools";

const queues = [
  { id: 1, name: "Comercial" },
  { id: 2, name: "Suporte" }
];

describe("buildToolSet", () => {
  it("offers only the enabled tools", () => {
    expect(buildToolSet({}, { queues }).definitions).toEqual([]);
    const names = buildToolSet({ transfer: { enabled: true }, close: { enabled: true } }, { queues }).definitions.map(
      d => d.name
    );
    expect(names).toEqual(["transferir_para_atendente", "encerrar_atendimento"]);
  });

  it("limits the transfer to the chosen queues", async () => {
    const set = buildToolSet({ transfer: { enabled: true, queueIds: [2] } }, { queues });
    const schema = set.definitions[0].parameters as any;
    expect(schema.properties.fila.enum).toEqual(["Suporte"]);

    const wrong = await set.execute("transferir_para_atendente", { fila: "Comercial", motivo: "x" });
    expect(wrong.error).toBe(true);
    expect(set.actions).toEqual([]);

    await set.execute("transferir_para_atendente", { fila: "Suporte", motivo: "Problema no pedido" });
    expect(set.actions).toEqual([{ type: "transfer", queueId: 2, reason: "Problema no pedido" }]);
  });

  it("allows a single ticket-changing action per turn", async () => {
    const set = buildToolSet({ transfer: { enabled: true }, close: { enabled: true } }, { queues });
    await set.execute("encerrar_atendimento", { motivo: "resolvido" });
    const second = await set.execute("transferir_para_atendente", { fila: "Suporte", motivo: "x" });
    expect(second.error).toBe(true);
    expect(set.actions).toHaveLength(1);
  });

  it("transfers without a queue when the company has none", async () => {
    const set = buildToolSet({ transfer: { enabled: true } }, { queues: [] });
    expect((set.definitions[0].parameters as any).required).toEqual(["motivo"]);
    await set.execute("transferir_para_atendente", { motivo: "quer falar com pessoa" });
    expect(set.actions[0]).toEqual({ type: "transfer", queueId: null, reason: "quer falar com pessoa" });
  });

  it("rejects unknown tools and invalid JSON", async () => {
    const set = buildToolSet({ close: { enabled: true } }, { queues });
    expect((await set.execute("apagar_tudo", {})).error).toBe(true);
    expect((await set.execute("encerrar_atendimento", { __invalidJson: "{" })).error).toBe(true);
  });
});
