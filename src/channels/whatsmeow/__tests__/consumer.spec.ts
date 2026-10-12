jest.mock("../handlers", () => ({ __esModule: true, default: jest.fn(), handleEnvelope: jest.fn() }));
jest.mock("../../../libs/systemLog", () => ({ recordLog: jest.fn(), newProtocol: () => "TESTPROTO" }));
jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  rawLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

/* eslint-disable import/first */
import crypto from "crypto";
import Redis from "ioredis";
import { recordLog } from "../../../libs/systemLog";
import {
  addConnection,
  consumerStats,
  ConsumerDeps,
  removeConnection,
  startConsumer,
  stopConsumer
} from "../consumer";

// Testes contra o Redis do HM (localhost:6379) em chaves com prefixo próprio,
// apagadas no fim. Nunca tocam nos streams reais wa:events:*.
const REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";
const PREFIX = `test:wazzy-consumer:${crypto.randomBytes(4).toString("hex")}:`;

jest.setTimeout(20000);

let redis: Redis;
let suite = 0;
let keyPrefix = "";

const streamKey = (id: number): string => `${keyPrefix}events:${id}`;
const deadKey = (): string => `${keyPrefix}dead`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> => {
  const started = Date.now();
  // eslint-disable-next-line no-await-in-loop
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor: tempo esgotado");
    // eslint-disable-next-line no-await-in-loop
    await sleep(20);
  }
};

const publish = async (connectionId: number, env: unknown, raw?: string): Promise<string> =>
  (await redis.xadd(streamKey(connectionId), "*", "e", raw ?? JSON.stringify(env))) as string;

const envelope = (connectionId: number, n: number, type = "message") => ({
  type,
  connectionId,
  ts: Date.now(),
  data: { n }
});

const pendingCount = async (connectionId: number): Promise<number> => {
  const summary = (await redis.xpending(streamKey(connectionId), "wazzy-api")) as any[];
  return Number(summary[0]);
};

const deps = (handle: ConsumerDeps["handle"], extra: Partial<ConsumerDeps> = {}): ConsumerDeps => ({
  createClient: () => new Redis(REDIS_URL),
  streamKey,
  deadKey: deadKey(),
  handle,
  blockMs: 200,
  claimIntervalMs: 100,
  claimMinIdleMs: 150,
  handlerTimeoutMs: 5000,
  retryDelaysMs: [80, 80, 80, 80],
  stopTimeoutMs: 2000,
  ...extra
});

beforeAll(async () => {
  redis = new Redis(REDIS_URL);
  await redis.ping();
});

beforeEach(() => {
  suite += 1;
  keyPrefix = `${PREFIX}${suite}:`;
});

afterEach(async () => {
  await stopConsumer({ timeoutMs: 300 });
});

afterAll(async () => {
  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

describe("consumer de Redis Streams do gateway", () => {
  it("processa em ordem por conexão e conexões diferentes em paralelo", async () => {
    const seen: Record<number, number[]> = { 1: [], 2: [] };
    let running = 0;
    let maxRunning = 0;
    const handle = jest.fn(async (env: any) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(Math.floor(Math.random() * 15));
      seen[env.connectionId].push(env.data.n);
      running -= 1;
    });
    for (let n = 1; n <= 10; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      await publish(1, envelope(1, n));
      // eslint-disable-next-line no-await-in-loop
      await publish(2, envelope(2, n));
    }

    await startConsumer([1, 2], deps(handle));
    await waitFor(() => seen[1].length === 10 && seen[2].length === 10);

    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(seen[1]).toEqual(expected);
    expect(seen[2]).toEqual(expected);
    expect(maxRunning).toBe(2);
    await waitFor(async () => (await pendingCount(1)) === 0 && (await pendingCount(2)) === 0);
  });

  it("lê o que já estava no stream antes de o grupo existir (grupo criado no id 0)", async () => {
    await publish(3, envelope(3, 1));
    const handle = jest.fn(async () => undefined);

    await startConsumer([3], deps(handle));

    await waitFor(() => handle.mock.calls.length === 1);
    expect((handle.mock.calls[0] as any[])[0]).toMatchObject({ connectionId: 3, data: { n: 1 } });
  });

  it("só confirma (XACK) depois que o handler termina", async () => {
    let release: () => void = () => undefined;
    const handle = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
    await startConsumer([1], deps(handle));
    await publish(1, envelope(1, 1));

    await waitFor(() => handle.mock.calls.length === 1);
    await sleep(100);
    expect(await pendingCount(1)).toBe(1);

    release();
    await waitFor(async () => (await pendingCount(1)) === 0);
  });

  it("falha segura a fila da conexão: tenta de novo a mesma entrada antes das seguintes", async () => {
    const calls: number[] = [];
    let failed = false;
    const handle = jest.fn(async (env: any) => {
      calls.push(env.data.n);
      if (env.data.n === 1 && !failed) {
        failed = true;
        throw new Error("banco fora");
      }
    });
    await startConsumer([1], deps(handle, { retryDelaysMs: [300] }));
    await publish(1, envelope(1, 1));

    await waitFor(() => calls.length === 1);
    // Reação que depende da mensagem 1 chega durante a espera.
    await publish(1, envelope(1, 2, "reaction"));
    await sleep(150);
    expect(calls).toEqual([1]);
    expect(await pendingCount(1)).toBeGreaterThanOrEqual(1);

    await waitFor(() => calls.length === 3);
    expect(calls).toEqual([1, 1, 2]);
    await waitFor(async () => (await pendingCount(1)) === 0);
    expect(await redis.exists(deadKey())).toBe(0);
  });

  it("antes de cada nova tentativa faz XCLAIM (contador de entregas persistido)", async () => {
    let fails = 2;
    const counts: number[] = [];
    const handle = jest.fn(async () => {
      const rows = (await redis.xpending(streamKey(1), "wazzy-api", "-", "+", 10)) as any[];
      counts.push(Number(rows[0][3]));
      if (fails > 0) {
        fails -= 1;
        throw new Error("falha");
      }
    });
    await startConsumer([1], deps(handle));
    await publish(1, envelope(1, 1));

    await waitFor(() => counts.length === 3);
    expect(counts).toEqual([1, 2, 3]);
    await waitFor(async () => (await pendingCount(1)) === 0);
  });

  it("stopConsumer interrompe a espera entre tentativas e a entrada fica pendente", async () => {
    const handle = jest.fn().mockRejectedValue(new Error("falha"));
    await startConsumer([1], deps(handle, { retryDelaysMs: [10000] }));
    await publish(1, envelope(1, 1));
    await waitFor(() => handle.mock.calls.length === 1);

    const started = Date.now();
    await stopConsumer();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(await pendingCount(1)).toBe(1);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("handler que passa do timeout não roda de novo em paralelo; a fila espera ele terminar", async () => {
    let running = 0;
    let maxRunning = 0;
    const calls: number[] = [];
    const handle = jest.fn(async (env: any) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      calls.push(env.data.n);
      if (env.data.n === 1) await sleep(600);
      running -= 1;
    });
    await startConsumer([1], deps(handle, { handlerTimeoutMs: 50, claimMinIdleMs: 100, claimIntervalMs: 50 }));
    await publish(1, envelope(1, 1));
    await publish(1, envelope(1, 2));

    await waitFor(() => calls.length === 2);
    expect(calls).toEqual([1, 2]);
    expect(maxRunning).toBe(1);
    await waitFor(async () => (await pendingCount(1)) === 0);
    await sleep(300);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("na 5ª falha manda para o dead letter, confirma e grava log do sistema com protocolo", async () => {
    const calls: number[] = [];
    const handle = jest.fn(async (env: any) => {
      calls.push(env.data.n);
      if (env.data.n === 1) throw new Error("sempre falha");
    });
    await startConsumer([1], deps(handle));
    const id = await publish(1, envelope(1, 1));
    await publish(1, envelope(1, 2));

    await waitFor(async () => (await redis.xlen(deadKey())) === 1);
    // Depois do dead letter a fila da conexão segue.
    await waitFor(() => calls.length === 6);
    expect(calls).toEqual([1, 1, 1, 1, 1, 2]);
    // XADD no dead letter vem antes do XACK (se o XADD falhar, segue pendente).
    await waitFor(async () => (await pendingCount(1)) === 0);

    const [[, fields]] = (await redis.xrange(deadKey(), "-", "+")) as [string, string[]][];
    const dead: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) dead[fields[i]] = fields[i + 1];
    expect(dead.stream).toBe(streamKey(1));
    expect(dead.id).toBe(id);
    expect(JSON.parse(dead.e)).toMatchObject({ connectionId: 1, data: { n: 1 } });
    expect(dead.error).toContain("sempre falha");
    expect(dead.connectionId).toBe("1");
    expect(dead.deliveries).toBe("5");

    expect(recordLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", protocol: "TESTPROTO", code: "WA_DEAD_LETTER" })
    );

    await sleep(400);
    expect(handle).toHaveBeenCalledTimes(6);
  });

  it("envelope com JSON inválido vai direto para o dead letter sem chamar o handler", async () => {
    const handle = jest.fn(async () => undefined);
    await startConsumer([1], deps(handle));
    await publish(1, null, "{isto não é json");
    await publish(1, envelope(1, 2));

    await waitFor(async () => (await redis.xlen(deadKey())) === 1);
    await waitFor(() => handle.mock.calls.length === 1);
    expect((handle.mock.calls[0] as any[])[0]).toMatchObject({ data: { n: 2 } });
    await waitFor(async () => (await pendingCount(1)) === 0);
  });

  it("entrada já entregue 5 vezes sem confirmação (queda em loop) vai para o dead letter sem rodar", async () => {
    await redis.xgroup("CREATE", streamKey(1), "wazzy-api", "0", "MKSTREAM");
    const id = await publish(1, envelope(1, 1));
    await redis.xreadgroup("GROUP", "wazzy-api", "fantasma", "STREAMS", streamKey(1), ">");
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await redis.xclaim(streamKey(1), "wazzy-api", "fantasma", 0, id);
    }
    const handle = jest.fn(async () => undefined);

    await startConsumer([1], deps(handle));

    await waitFor(async () => (await redis.xlen(deadKey())) === 1);
    expect(handle).not.toHaveBeenCalled();
    await waitFor(async () => (await pendingCount(1)) === 0);
  });

  it("deploy: o consumidor novo processa antes os pendentes do antigo (outro nome) e o handler idempotente não duplica", async () => {
    // Primeira instância: lê 1 e 2, trava no 1 e "cai".
    const hang = jest.fn(() => new Promise<void>(() => undefined));
    await startConsumer([1], deps(hang, { consumerName: "instancia-a", claimMinIdleMs: 60000 }));
    await publish(1, envelope(1, 1));
    await publish(1, envelope(1, 2));
    await waitFor(() => hang.mock.calls.length === 1);
    await waitFor(async () => (await pendingCount(1)) === 2);
    await stopConsumer({ timeoutMs: 50 });

    await publish(1, envelope(1, 3));

    // Segunda instância, com outro nome e min-idle alto: pega os pendentes de
    // todos os consumidores do grupo antes da primeira leitura com ">".
    const order: number[] = [];
    const applied = new Set<number>();
    const handle = jest.fn(async (env: any) => {
      order.push(env.data.n);
      if (applied.has(env.data.n)) return; // idempotente (como Message.count por id)
      applied.add(env.data.n);
    });
    await startConsumer([1], deps(handle, { consumerName: "instancia-b", claimMinIdleMs: 60000 }));

    await waitFor(() => applied.size === 3);
    await waitFor(async () => (await pendingCount(1)) === 0);
    expect(order).toEqual([1, 2, 3]);
    await sleep(400);
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it("reinício com o mesmo nome processa os próprios pendentes antes das novas entradas", async () => {
    const hang = jest.fn(() => new Promise<void>(() => undefined));
    await startConsumer([1], deps(hang, { consumerName: "mesmo", claimMinIdleMs: 60000 }));
    await publish(1, envelope(1, 1));
    await publish(1, envelope(1, 2));
    await waitFor(async () => (await pendingCount(1)) === 2);
    await stopConsumer({ timeoutMs: 50 });
    await publish(1, envelope(1, 3));

    const order: number[] = [];
    const handle = jest.fn(async (env: any) => { order.push(env.data.n); });
    await startConsumer([1], deps(handle, { consumerName: "mesmo", claimMinIdleMs: 60000 }));

    await waitFor(() => order.length === 3);
    expect(order).toEqual([1, 2, 3]);
    await waitFor(async () => (await pendingCount(1)) === 0);
  });

  it("removeConnection para de ler o stream e mantém os dados; addConnection volta a ler", async () => {
    const handle = jest.fn(async () => undefined);
    await startConsumer([1, 2], deps(handle));
    await removeConnection(2);

    await publish(2, envelope(2, 1));
    await publish(1, envelope(1, 1));
    await waitFor(() => handle.mock.calls.length === 1);
    await sleep(400);
    expect(handle).toHaveBeenCalledTimes(1);
    expect((handle.mock.calls[0] as any[])[0]).toMatchObject({ connectionId: 1 });
    expect(await redis.xlen(streamKey(2))).toBe(1);

    await addConnection(2);
    await waitFor(() => handle.mock.calls.length === 2);
    expect((handle.mock.calls[1] as any[])[0]).toMatchObject({ connectionId: 2 });
  });

  it("addConnection de conexão nova cria o grupo e passa a ler", async () => {
    const handle = jest.fn(async () => undefined);
    await startConsumer([], deps(handle));
    await addConnection(7);
    await publish(7, envelope(7, 1));

    await waitFor(() => handle.mock.calls.length === 1);
    const groups = (await redis.xinfo("GROUPS", streamKey(7))) as any[];
    expect(groups.length).toBe(1);
  });

  it("stopConsumer espera o handler em andamento terminar, confirma e para de ler", async () => {
    let finished = false;
    const handle = jest.fn(async () => {
      await sleep(300);
      finished = true;
    });
    await startConsumer([1], deps(handle));
    await publish(1, envelope(1, 1));
    await waitFor(() => handle.mock.calls.length === 1);

    await stopConsumer();
    expect(finished).toBe(true);
    expect(await pendingCount(1)).toBe(0);

    await publish(1, envelope(1, 2));
    await sleep(400);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("consumerStats informa pendentes, atraso e dead letters", async () => {
    let release: () => void = () => undefined;
    const handle = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
    await startConsumer([1], deps(handle, { claimMinIdleMs: 60000 }));
    await publish(1, envelope(1, 1));
    await waitFor(() => handle.mock.calls.length === 1);
    await sleep(120);

    const stats = await consumerStats();
    expect(stats.running).toBe(true);
    expect(stats.pending).toBe(1);
    expect(stats.deadLetters).toBe(0);
    expect(stats.lagMs).toBeGreaterThanOrEqual(100);
    expect(stats.connections).toEqual([
      expect.objectContaining({ connectionId: 1, stream: streamKey(1), pending: 1 })
    ]);

    release();
    await waitFor(async () => (await consumerStats()).pending === 0);
    expect((await consumerStats()).lagMs).toBe(0);
  });
});
