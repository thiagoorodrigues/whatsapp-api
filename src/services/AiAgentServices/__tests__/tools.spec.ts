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

describe("CRM tools", () => {
  const crmOn = { crm: { enabled: true, funnelId: 5, stageId: 25, qualifiedStageId: 26 } };

  it("are offered only when enabled with a funnel and a stage", () => {
    const names = (cfg: any) => buildToolSet(cfg, { queues }).definitions.map(d => d.name);
    expect(names({ crm: { enabled: false, funnelId: 5, stageId: 25, qualifiedStageId: null } })).toEqual([]);
    expect(names({ crm: { enabled: true, funnelId: 5, stageId: null, qualifiedStageId: null } })).toEqual([]);
    expect(names({ crm: { enabled: true, funnelId: 5, stageId: 25, qualifiedStageId: null } })).toEqual(["registrar_negocio"]);
    expect(names(crmOn)).toEqual(["registrar_negocio", "marcar_lead_qualificado"]);
  });

  it("only simulate in the test console (no CRM context)", async () => {
    const set = buildToolSet(crmOn, { queues });
    const r = await set.execute("registrar_negocio", { resumo: "Quer plano anual", valor: 1500 });
    expect(r.error).toBeFalsy();
    expect(r.result).toMatch(/simulação/i);
    const q = await set.execute("marcar_lead_qualificado", {});
    expect(q.result).toMatch(/simulação/i);
  });

  it("pass the model's input to the CRM and report its answer", async () => {
    const register = jest.fn().mockResolvedValue({ ok: true, message: "Negócio criado no CRM para este contato." });
    const qualify = jest.fn().mockResolvedValue({ ok: false, message: "Registre o negócio antes." });
    const set = buildToolSet(crmOn, { queues, crm: { register, qualify } });
    const r = await set.execute("registrar_negocio", { resumo: " Quer plano anual ", titulo: "Plano anual", valor: "1.500,00", origem: "instagram" });
    expect(register).toHaveBeenCalledWith({ summary: "Quer plano anual", title: "Plano anual", value: "1.500,00", source: "instagram" });
    expect(r).toEqual({ result: "Negócio criado no CRM para este contato." });
    const q = await set.execute("marcar_lead_qualificado", {});
    expect(q).toEqual({ result: "Registre o negócio antes.", error: true });
  });

  it("refuses an empty summary before calling the CRM", async () => {
    const register = jest.fn();
    const set = buildToolSet(crmOn, { queues, crm: { register, qualify: jest.fn() } });
    const r = await set.execute("registrar_negocio", { resumo: "  " });
    expect(r.error).toBe(true);
    expect(register).not.toHaveBeenCalled();
  });
});
