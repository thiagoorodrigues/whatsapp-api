import { buildToolSet } from "../tools";

const queues = [
  { id: 1, name: "Comercial" },
  { id: 2, name: "Suporte" }
];
const users = [{ id: 9, name: "Maria" }];

describe("buildToolSet", () => {
  it("offers only the enabled tools", () => {
    expect(buildToolSet({}, { queues }).definitions).toEqual([]);
    const names = buildToolSet({ transfer: { enabled: true }, close: { enabled: true } }, { queues }).definitions.map(
      d => d.name
    );
    expect(names).toEqual(["transferir_para_atendente", "encerrar_atendimento"]);
  });

  it("limits the transfer to the chosen queues (older setting)", async () => {
    const set = buildToolSet({ transfer: { enabled: true, queueIds: [2] } }, { queues });
    const schema = set.definitions[0].parameters as any;
    expect(schema.properties.destino.enum).toEqual(["Setor: Suporte"]);

    const wrong = await set.execute("transferir_para_atendente", { destino: "Setor: Comercial", motivo: "x" });
    expect(wrong.error).toBe(true);
    expect(set.actions).toEqual([]);

    await set.execute("transferir_para_atendente", { destino: "Setor: Suporte", motivo: "Problema no pedido" });
    expect(set.actions).toEqual([{ type: "transfer", queueId: 2, userId: null, keepAgent: false, reason: "Problema no pedido" }]);
  });

  it("transfers to queues and people with when to use each", async () => {
    const transfer = {
      enabled: true,
      keepAgent: true,
      targets: [
        { kind: "queue" as const, id: 2, instructions: "problema técnico" },
        { kind: "user" as const, id: 9, instructions: "cliente empresa" }
      ]
    };
    const set = buildToolSet({ transfer }, { queues, users });
    const def = set.definitions[0];
    expect((def.parameters as any).properties.destino.enum).toEqual(["Setor: Suporte", "Atendente: Maria"]);
    expect(def.description).toContain("Setor: Suporte: problema técnico");
    expect(def.description).toContain("Atendente: Maria: cliente empresa");

    await set.execute("transferir_para_atendente", { destino: "Atendente: Maria", motivo: "CNPJ" });
    expect(set.actions).toEqual([{ type: "transfer", queueId: null, userId: 9, keepAgent: false, reason: "CNPJ" }]);
    const again = buildToolSet({ transfer }, { queues, users });
    await again.execute("transferir_para_atendente", { destino: "Setor: Suporte", motivo: "erro" });
    expect(again.actions[0]).toMatchObject({ queueId: 2, userId: null, keepAgent: true });
  });

  it("drops destinations that no longer exist", () => {
    const set = buildToolSet(
      { transfer: { enabled: true, targets: [{ kind: "user", id: 99, instructions: "" }, { kind: "queue", id: 1, instructions: "" }] } },
      { queues, users }
    );
    expect((set.definitions[0].parameters as any).properties.destino.enum).toEqual(["Setor: Comercial"]);
  });

  it("allows a single ticket-changing action per turn", async () => {
    const set = buildToolSet({ transfer: { enabled: true }, close: { enabled: true } }, { queues });
    await set.execute("encerrar_atendimento", { motivo: "resolvido" });
    const second = await set.execute("transferir_para_atendente", { destino: "Setor: Suporte", motivo: "x" });
    expect(second.error).toBe(true);
    expect(set.actions).toHaveLength(1);
  });

  it("transfers without a queue when the company has none", async () => {
    const set = buildToolSet({ transfer: { enabled: true } }, { queues: [] });
    expect((set.definitions[0].parameters as any).required).toEqual(["motivo"]);
    await set.execute("transferir_para_atendente", { motivo: "quer falar com pessoa" });
    expect(set.actions[0]).toEqual({ type: "transfer", queueId: null, userId: null, keepAgent: false, reason: "quer falar com pessoa" });
  });

  it("rejects unknown tools and invalid JSON", async () => {
    const set = buildToolSet({ close: { enabled: true } }, { queues });
    expect((await set.execute("apagar_tudo", {})).error).toBe(true);
    expect((await set.execute("encerrar_atendimento", { __invalidJson: "{" })).error).toBe(true);
  });
});

describe("CRM tools", () => {
  const crmStages = [
    { id: 25, name: "Lead" },
    { id: 26, name: "Qualificado" },
    { id: 27, name: "Proposta" }
  ];
  const legacy = { crm: { enabled: true, funnelId: 5, stageId: 25, qualifiedStageId: 26 } };
  const crmOn = {
    crm: {
      enabled: true,
      funnelId: 5,
      stageId: 25,
      qualifiedStageId: null,
      moveStages: [
        { stageId: 26, instructions: "confirmou interesse" },
        { stageId: 27, instructions: "pediu cotação" }
      ]
    }
  };

  it("are offered only when enabled with a funnel and a stage", () => {
    const names = (cfg: any) => buildToolSet(cfg, { queues, crmStages }).definitions.map(d => d.name);
    expect(names({ crm: { enabled: false, funnelId: 5, stageId: 25, qualifiedStageId: null } })).toEqual([]);
    expect(names({ crm: { enabled: true, funnelId: 5, stageId: null, qualifiedStageId: null } })).toEqual([]);
    expect(names({ crm: { enabled: true, funnelId: 5, stageId: 25, qualifiedStageId: null } })).toEqual(["registrar_negocio"]);
    expect(names(crmOn)).toEqual(["registrar_negocio", "mover_negocio"]);
  });

  it("lists the stages with when to move to each", () => {
    const def = buildToolSet(crmOn, { queues, crmStages }).definitions[1];
    expect((def.parameters as any).properties.etapa.enum).toEqual(["Qualificado", "Proposta"]);
    expect(def.description).toContain("Proposta: pediu cotação");
  });

  it("turns the older qualified column into a stage", () => {
    const def = buildToolSet(legacy, { queues, crmStages }).definitions[1];
    expect((def.parameters as any).properties.etapa.enum).toEqual(["Qualificado"]);
  });

  it("only simulate in the test console (no CRM context)", async () => {
    const set = buildToolSet(crmOn, { queues, crmStages });
    const r = await set.execute("registrar_negocio", { resumo: "Quer plano anual", valor: 1500 });
    expect(r.error).toBeFalsy();
    expect(r.result).toMatch(/simulação/i);
    const q = await set.execute("mover_negocio", { etapa: "Proposta" });
    expect(q.result).toMatch(/simulação/i);
  });

  it("pass the model's input to the CRM and report its answer", async () => {
    const register = jest.fn().mockResolvedValue({ ok: true, message: "Negócio criado no CRM para este contato." });
    const move = jest.fn().mockResolvedValue({ ok: false, message: "Registre o negócio antes." });
    const set = buildToolSet(crmOn, { queues, crmStages, crm: { register, move } });
    const r = await set.execute("registrar_negocio", { resumo: " Quer plano anual ", titulo: "Plano anual", valor: "1.500,00", origem: "instagram" });
    expect(register).toHaveBeenCalledWith({ summary: "Quer plano anual", title: "Plano anual", value: "1.500,00", source: "instagram" });
    expect(r).toEqual({ result: "Negócio criado no CRM para este contato." });
    expect((await set.execute("mover_negocio", { etapa: "Lead" })).error).toBe(true);
    const q = await set.execute("mover_negocio", { etapa: "Proposta" });
    expect(move).toHaveBeenCalledWith(27);
    expect(q).toEqual({ result: "Registre o negócio antes.", error: true });
  });

  it("refuses an empty summary before calling the CRM", async () => {
    const register = jest.fn();
    const set = buildToolSet(crmOn, { queues, crmStages, crm: { register, move: jest.fn() } });
    const r = await set.execute("registrar_negocio", { resumo: "  " });
    expect(r.error).toBe(true);
    expect(register).not.toHaveBeenCalled();
  });

  describe("adicionar_tag", () => {
    const list = [
      { id: 7, name: "Lead quente" },
      { id: 8, name: "Cliente" }
    ];

    it("is offered only with the tool on and tags to choose", () => {
      expect(buildToolSet({ tag: { enabled: true } }, { queues, tags: { list: [] } }).definitions).toEqual([]);
      expect(buildToolSet({ tag: { enabled: false } }, { queues, tags: { list } }).definitions).toEqual([]);
      const [def] = buildToolSet(
        { tag: { enabled: true, instructions: "Lead quente quando pedir preço" } },
        { queues, tags: { list } }
      ).definitions;
      expect(def.name).toBe("adicionar_tag");
      expect((def.parameters as any).properties.tag.enum).toEqual(["Lead quente", "Cliente"]);
      expect(def.description).toContain("Lead quente quando pedir preço");
    });

    it("adds the chosen tag and refuses others", async () => {
      const add = jest.fn().mockResolvedValue({ ok: true, message: "Tag adicionada." });
      const set = buildToolSet({ tag: { enabled: true } }, { queues, tags: { list, add } });
      expect(await set.execute("adicionar_tag", { tag: "Cliente" })).toEqual({ result: "Tag adicionada." });
      expect(add).toHaveBeenCalledWith(8);
      const wrong = await set.execute("adicionar_tag", { tag: "VIP" });
      expect(wrong.error).toBe(true);
      expect(add).toHaveBeenCalledTimes(1);
      expect(set.actions).toEqual([]);
    });

    it("only simulates in the test console", async () => {
      const set = buildToolSet({ tag: { enabled: true } }, { queues, tags: { list } });
      const res = await set.execute("adicionar_tag", { tag: "Cliente" });
      expect(res.error).toBeFalsy();
      expect(res.result).toContain("Simulação");
    });
  });
});

describe("agendar_mensagem", () => {
  const now = new Date(2026, 9, 9, 10, 0); // 09/10/2026 10:00, local time
  const cfg = { schedule: { enabled: true, instructions: "Lembrete de vencimento", maxDays: 30 } };

  it("tells the model to confirm the date and follows the instructions", () => {
    const [def] = buildToolSet(cfg, { queues, now }).definitions;
    expect(def.name).toBe("agendar_mensagem");
    expect(def.description).toContain("confirme");
    expect(def.description).toContain("Lembrete de vencimento");
  });

  it("schedules a future message within the limit, once per reply", async () => {
    const schedule = jest.fn().mockResolvedValue({ ok: true, message: "Agendado para 12/10/2026 às 14:00." });
    const set = buildToolSet(cfg, { queues, now, schedule });
    const r = await set.execute("agendar_mensagem", { data_hora: "2026-10-12T14:00", mensagem: "Seu boleto vence amanhã!" });
    expect(r).toEqual({ result: "Agendado para 12/10/2026 às 14:00." });
    expect(schedule).toHaveBeenCalledWith({ sendAt: new Date(2026, 9, 12, 14, 0), body: "Seu boleto vence amanhã!" });
    const second = await set.execute("agendar_mensagem", { data_hora: "2026-10-13T14:00", mensagem: "Outro lembrete" });
    expect(second.error).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("refuses past, too far, invalid dates and short texts", async () => {
    const schedule = jest.fn();
    const run = (input: any) => buildToolSet(cfg, { queues, now, schedule }).execute("agendar_mensagem", input);
    expect((await run({ data_hora: "2026-10-09T09:00", mensagem: "Bom dia, tudo certo?" })).error).toBe(true);
    expect((await run({ data_hora: "2026-12-20T09:00", mensagem: "Bom dia, tudo certo?" })).error).toBe(true);
    expect((await run({ data_hora: "amanhã às 9", mensagem: "Bom dia, tudo certo?" })).error).toBe(true);
    expect((await run({ data_hora: "2026-10-12T14:00", mensagem: "oi" })).error).toBe(true);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("only simulates in the test console", async () => {
    const set = buildToolSet(cfg, { queues, now });
    const r = await set.execute("agendar_mensagem", { data_hora: "2026-10-12T14:00", mensagem: "Seu boleto vence amanhã!" });
    expect(r.error).toBeFalsy();
    expect(r.result).toContain("Simulação");
    expect(r.result).toContain("12/10/2026 às 14:00");
  });

  it("describes the knowledge search by meaning when semantic search is on", () => {
    const search = jest.fn(async () => []);
    const byWords = buildToolSet({}, { queues: [], searchKnowledge: search });
    const byMeaning = buildToolSet({}, { queues: [], searchKnowledge: search, semanticKnowledge: true });
    const description = (set: any) => set.definitions.find((d: any) => d.name === "buscar_base_conhecimento").description;
    expect(description(byWords)).toContain("A busca é por palavras");
    expect(description(byMeaning)).not.toContain("A busca é por palavras");
    expect(description(byMeaning)).toContain("pelo sentido");
  });
});

