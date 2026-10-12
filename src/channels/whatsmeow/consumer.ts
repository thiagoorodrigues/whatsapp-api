import os from "os";
import Redis from "ioredis";
import { REDIS_URI_CONNECTION } from "../../config/redis";
import handleEnvelope, { GatewayEnvelope } from "./handlers";
import { newProtocol, recordLog } from "../../libs/systemLog";
import { logger, rawLogger } from "../../utils/logger";

// Consumer dos eventos que o gateway whatsmeow publica em wa:events:{id}
// (uma entrada por evento, campo único `e` com o envelope JSON; o gateway
// apaga o que tem mais de ~3 dias com MINID). Garantias:
//
// - Grupo `wazzy-api` por stream, criado no id `0` com MKSTREAM: na primeira
//   vez lê tudo o que ainda está retido, para não perder o que o gateway
//   publicou antes de a api subir com o motor whatsmeow (os handlers são
//   idempotentes, então reprocessar eventos antigos não duplica nada).
// - Em série por conexão (uma entrada por vez, na ordem do stream); conexões
//   diferentes andam em paralelo.
// - XACK só depois que o handler termina sem lançar. Falha = fica pendente e
//   volta pela varredura (XPENDING IDLE + XCLAIM) depois de `claimMinIdleMs`.
//   Na 5ª entrega sem sucesso: XADD wa:dead + XACK + Log do sistema com
//   protocolo. Envelope ilegível vai direto para wa:dead.
//
// Ordem x falhas: uma entrada que falhou não trava a conexão; as seguintes
// seguem e ela volta para o fim da fila na varredura. Travar a conexão
// esperando a nova tentativa (até ~5 min) atrasaria todas as conversas por
// causa de um evento ruim; os handlers toleram a troca (ack nunca volta,
// mensagem deduplicada por id). Na volta da api com o mesmo nome de
// consumidor (container reiniciado), os pendentes do próprio consumidor são
// processados antes das entradas novas; os de outro nome (deploy novo) só
// voltam pela varredura, depois de ficarem `claimMinIdleMs` parados.
//
// A varredura usa XPENDING + XCLAIM em vez de XAUTOCLAIM porque precisa do
// contador de entregas (o XAUTOCLAIM não devolve) e porque não pode tomar de
// volta uma entrada que ainda está rodando aqui (handler lento > min-idle).

export const CONSUMER_GROUP = "wazzy-api";
export const DEAD_LETTER_STREAM = "wa:dead";
export const MAX_DELIVERIES = 5;

export interface ConsumerDeps {
  /** Cria uma conexão Redis (uma para comandos, outra só para o XREADGROUP bloqueante). */
  createClient?: () => Redis;
  streamKey?: (connectionId: number) => string;
  deadKey?: string;
  group?: string;
  consumerName?: string;
  handle?: (env: GatewayEnvelope) => Promise<void>;
  blockMs?: number;
  batchSize?: number;
  /** Máximo de entradas na fila local de uma conexão antes de parar de ler o stream dela. */
  laneHighWater?: number;
  claimIntervalMs?: number;
  claimMinIdleMs?: number;
  maxDeliveries?: number;
  handlerTimeoutMs?: number;
  stopTimeoutMs?: number;
  deadMaxLen?: number;
  /** Consumidores sem pendentes e parados há mais que isso saem do grupo. */
  staleConsumerMs?: number;
}

export interface ConnectionStats {
  connectionId: number;
  stream: string;
  /** Entregues e ainda não confirmadas. */
  pending: number;
  /** Ainda não entregues ao grupo (null quando o Redis não sabe calcular). */
  lag: number | null;
  /** Idade da entrada mais antiga não confirmada (pendente ou não entregue). */
  lagMs: number;
  queued: number;
}

export interface ConsumerStats {
  running: boolean;
  consumer: string | null;
  pending: number;
  lagMs: number;
  deadLetters: number;
  connections: ConnectionStats[];
}

interface Entry {
  id: string;
  fields: string[];
  /** Quantas vezes o Redis já entregou esta entrada, contando esta. */
  deliveries: number;
}

interface Lane {
  connectionId: number;
  key: string;
  active: boolean;
  items: Entry[];
  /** Ids na fila local ou rodando: a varredura não pega de novo. */
  known: Set<string>;
  worker: Promise<void> | null;
}

type StreamReply = [string, [string, string[]][]][] | null;

const fieldOf = (fields: string[], name: string): string | undefined => {
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
};

const pairs = (flat: any[]): Record<string, any> => {
  const out: Record<string, any> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = flat[i + 1];
  return out;
};

const idMs = (id: string): number => Number(String(id).split("-")[0]) || 0;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`handler não terminou em ${ms} ms`)), ms);
    // Não segura o processo no desligamento por causa de um handler travado.
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

class StreamConsumer {
  readonly name: string;

  private readonly redis: Redis;

  private readonly blocking: Redis;

  private readonly lanes = new Map<number, Lane>();

  private readonly opts: Required<Omit<ConsumerDeps, "createClient" | "consumerName">>;

  private stopping = false;

  private blockingId: number | null = null;

  private readLoop: Promise<void> | null = null;

  private sweepTimer: NodeJS.Timeout | null = null;

  private sweeping: Promise<void> | null = null;

  private waker: (() => void) | null = null;

  constructor(deps: ConsumerDeps) {
    const create = deps.createClient || (() => new Redis(REDIS_URI_CONNECTION));
    this.redis = create();
    this.blocking = create();
    this.name = deps.consumerName || `${os.hostname()}-${process.pid}`;
    this.opts = {
      streamKey: deps.streamKey || (id => `wa:events:${id}`),
      deadKey: deps.deadKey || DEAD_LETTER_STREAM,
      group: deps.group || CONSUMER_GROUP,
      handle: deps.handle || (env => handleEnvelope(env)),
      blockMs: deps.blockMs ?? 5000,
      batchSize: deps.batchSize ?? 50,
      laneHighWater: deps.laneHighWater ?? 200,
      claimIntervalMs: deps.claimIntervalMs ?? 30000,
      claimMinIdleMs: deps.claimMinIdleMs ?? 60000,
      maxDeliveries: deps.maxDeliveries ?? MAX_DELIVERIES,
      handlerTimeoutMs: deps.handlerTimeoutMs ?? 180000,
      stopTimeoutMs: deps.stopTimeoutMs ?? 15000,
      deadMaxLen: deps.deadMaxLen ?? 10000,
      staleConsumerMs: deps.staleConsumerMs ?? 24 * 60 * 60 * 1000
    };
    // Depois de reconectar, o id da conexão bloqueante muda (CLIENT UNBLOCK).
    this.blocking.on("ready", () => {
      this.refreshBlockingId();
    });
    this.redis.on("error", err => rawLogger.warn(`consumer whatsmeow: Redis: ${errorText(err)}`));
    this.blocking.on("error", err => rawLogger.warn(`consumer whatsmeow: Redis (leitura): ${errorText(err)}`));
  }

  async start(connectionIds: number[]): Promise<void> {
    await this.refreshBlockingId();
    for (const id of connectionIds) {
      // eslint-disable-next-line no-await-in-loop
      await this.attach(id);
    }
    this.readLoop = this.read();
    this.scheduleSweep(0);
  }

  async add(connectionId: number): Promise<void> {
    if (this.stopping) return;
    await this.attach(connectionId);
    this.interrupt();
  }

  remove(connectionId: number): void {
    const lane = this.lanes.get(connectionId);
    if (!lane) return;
    // A entrada em andamento termina; as que estavam na fila local ficam
    // pendentes no Redis e voltam se a conexão for adicionada de novo.
    lane.active = false;
    this.interrupt();
  }

  async stop(timeoutMs = this.opts.stopTimeoutMs): Promise<void> {
    this.stopping = true;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    this.interrupt();
    const workers = [...this.lanes.values()].map(lane => lane.worker).filter(Boolean) as Promise<void>[];
    const done = Promise.all([this.readLoop, this.sweeping, ...workers]).then(() => true);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const finished = await Promise.race([done, timeout]);
    clearTimeout(timer);
    if (!finished) logger.warn(`consumer whatsmeow: desligado sem esperar handlers em andamento (${timeoutMs} ms)`);
    this.blocking.disconnect();
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  async stats(): Promise<ConsumerStats> {
    const connections: ConnectionStats[] = [];
    const now = Date.now();
    for (const lane of this.lanes.values()) {
      if (!lane.active) continue;
      // eslint-disable-next-line no-await-in-loop
      connections.push(await this.laneStats(lane, now));
    }
    const deadLetters = await this.redis.xlen(this.opts.deadKey).catch(() => 0);
    return {
      running: !this.stopping,
      consumer: this.name,
      pending: connections.reduce((sum, c) => sum + c.pending, 0),
      lagMs: connections.reduce((max, c) => Math.max(max, c.lagMs), 0),
      deadLetters,
      connections
    };
  }

  // --- conexões e grupo ---

  private async attach(connectionId: number): Promise<void> {
    let lane = this.lanes.get(connectionId);
    if (!lane) {
      lane = {
        connectionId,
        key: this.opts.streamKey(connectionId),
        active: true,
        items: [],
        known: new Set(),
        worker: null
      };
      this.lanes.set(connectionId, lane);
    }
    lane.active = true;
    try {
      await this.ensureGroup(lane.key);
      // Pendentes do próprio consumidor (reinício com o mesmo nome, ou a
      // conexão voltou): antes das entradas novas, para manter a ordem.
      await this.claim(lane, 0, this.name);
    } catch (err) {
      // Redis fora: a leitura tenta de novo e recria o grupo (NOGROUP).
      logger.warn(`consumer whatsmeow: falha ao preparar ${lane.key}: ${errorText(err)}`);
    }
  }

  private async ensureGroup(key: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", key, this.opts.group, "0", "MKSTREAM");
    } catch (err) {
      if (!/BUSYGROUP/.test(errorText(err))) throw err;
    }
  }

  // --- leitura ---

  private async read(): Promise<void> {
    let backoff = 0;
    while (!this.stopping) {
      const lanes = [...this.lanes.values()].filter(l => l.active && l.items.length < this.opts.laneHighWater);
      if (!lanes.length) {
        // eslint-disable-next-line no-await-in-loop
        await this.pause(this.opts.blockMs);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const reply = (await this.blocking.call(
          "XREADGROUP",
          "GROUP",
          this.opts.group,
          this.name,
          "COUNT",
          String(this.opts.batchSize),
          "BLOCK",
          String(this.opts.blockMs),
          "STREAMS",
          ...lanes.map(l => l.key),
          ...lanes.map(() => ">")
        )) as StreamReply;
        if (backoff) logger.info("consumer whatsmeow: leitura do Redis restabelecida");
        backoff = 0;
        for (const [key, entries] of reply || []) {
          const lane = lanes.find(l => l.key === key);
          // Conexão removida durante a leitura: as entradas ficam pendentes.
          if (lane) for (const [id, fields] of entries) this.enqueue(lane, { id, fields: fields || [], deliveries: 1 });
        }
      } catch (err) {
        if (this.stopping) break;
        const text = errorText(err);
        if (/NOGROUP/.test(text)) {
          // eslint-disable-next-line no-await-in-loop
          for (const lane of lanes) await this.ensureGroup(lane.key).catch(() => undefined);
        } else if (!backoff) {
          logger.warn(`consumer whatsmeow: falha ao ler os streams: ${text}`);
        } else {
          rawLogger.warn(`consumer whatsmeow: falha ao ler os streams: ${text}`);
        }
        backoff = Math.min(backoff ? backoff * 2 : 250, 10000);
        // eslint-disable-next-line no-await-in-loop
        await this.pause(backoff);
      }
    }
  }

  /** Acorda a leitura bloqueada (conexão entrou/saiu, fila esvaziou, desligamento). */
  private interrupt(): void {
    if (this.waker) this.waker();
    if (this.blockingId !== null) {
      this.redis.call("CLIENT", "UNBLOCK", String(this.blockingId)).catch(() => undefined);
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.waker = () => {
        this.waker = null;
        done();
      };
    });
  }

  private async refreshBlockingId(): Promise<void> {
    try {
      this.blockingId = Number(await this.blocking.call("CLIENT", "ID"));
    } catch {
      this.blockingId = null;
    }
  }

  // --- fila por conexão ---

  private enqueue(lane: Lane, entry: Entry): void {
    if (lane.known.has(entry.id)) return;
    lane.known.add(entry.id);
    lane.items.push(entry);
    this.pump(lane);
  }

  private pump(lane: Lane): void {
    if (lane.worker) return;
    lane.worker = (async () => {
      while (lane.active && !this.stopping && lane.items.length) {
        const entry = lane.items.shift() as Entry;
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.process(lane, entry);
        } catch (err) {
          // Falha do próprio Redis (XADD do dead letter): segue pendente.
          rawLogger.warn(`consumer whatsmeow: ${lane.key} ${entry.id}: ${errorText(err)}`);
        } finally {
          lane.known.delete(entry.id);
        }
        if (lane.items.length + 1 === this.opts.laneHighWater) this.interrupt();
      }
      if (!lane.active || this.stopping) {
        lane.items.forEach(item => lane.known.delete(item.id));
        lane.items = [];
      }
      lane.worker = null;
    })();
  }

  private async process(lane: Lane, entry: Entry): Promise<void> {
    const raw = fieldOf(entry.fields, "e");
    const max = this.opts.maxDeliveries;
    if (entry.deliveries > max) {
      // Entregue `max` vezes sem confirmação nem falha registrada: o processo
      // caiu no meio do handler repetidas vezes. Não roda de novo.
      await this.deadLetter(lane, entry, raw, `entregue ${entry.deliveries - 1} vezes sem confirmação`);
      return;
    }
    let env: GatewayEnvelope;
    try {
      env = JSON.parse(raw ?? "");
      if (!env || typeof env !== "object" || Array.isArray(env)) throw new Error("não é um objeto");
    } catch (err) {
      await this.deadLetter(lane, entry, raw, `envelope inválido: ${errorText(err)}`);
      return;
    }
    try {
      await withTimeout(Promise.resolve().then(() => this.opts.handle(env)), this.opts.handlerTimeoutMs);
    } catch (err) {
      if (entry.deliveries >= max) {
        await this.deadLetter(lane, entry, raw, err);
        return;
      }
      rawLogger.warn(
        `consumer whatsmeow: ${lane.key} ${entry.id} (${env.type}) falhou na tentativa ${entry.deliveries}/${max}: ${errorText(err)}`
      );
      return;
    }
    await this.ack(lane, entry.id);
  }

  private async ack(lane: Lane, id: string): Promise<void> {
    try {
      await this.redis.xack(lane.key, this.opts.group, id);
    } catch (err) {
      // Volta pela varredura; os handlers são idempotentes.
      rawLogger.warn(`consumer whatsmeow: XACK de ${lane.key} ${id} falhou: ${errorText(err)}`);
    }
  }

  private async deadLetter(lane: Lane, entry: Entry, raw: string | undefined, err: unknown): Promise<void> {
    const error = errorText(err);
    await this.redis.xadd(
      this.opts.deadKey,
      "MAXLEN",
      "~",
      String(this.opts.deadMaxLen),
      "*",
      "stream",
      lane.key,
      "id",
      entry.id,
      "connectionId",
      String(lane.connectionId),
      "envelope",
      raw ?? "",
      "error",
      error,
      "deliveries",
      String(entry.deliveries)
    );
    await this.ack(lane, entry.id);
    let type: string | undefined;
    try {
      type = JSON.parse(raw ?? "")?.type;
    } catch {
      type = undefined;
    }
    const protocol = newProtocol();
    const message = `Evento do gateway descartado após ${entry.deliveries} tentativa(s): ${type || "envelope inválido"} da conexão ${lane.connectionId}`;
    recordLog({
      level: "error",
      source: "job",
      protocol,
      code: "WA_DEAD_LETTER",
      message,
      detail: err instanceof Error ? err.stack || error : error,
      context: { stream: lane.key, id: entry.id, type, deliveries: entry.deliveries, deadLetter: this.opts.deadKey }
    });
    rawLogger.error(`consumer whatsmeow: ${message} [${protocol}]: ${error}`);
  }

  // --- varredura de pendentes ---

  private scheduleSweep(delay = this.opts.claimIntervalMs): void {
    if (this.stopping) return;
    this.sweepTimer = setTimeout(() => {
      this.sweeping = this.sweep().finally(() => {
        this.sweeping = null;
        this.scheduleSweep();
      });
    }, delay);
    if (typeof this.sweepTimer.unref === "function") this.sweepTimer.unref();
  }

  private async sweep(): Promise<void> {
    for (const lane of this.lanes.values()) {
      if (!lane.active || this.stopping) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.claim(lane, this.opts.claimMinIdleMs);
        // eslint-disable-next-line no-await-in-loop
        await this.forgetStaleConsumers(lane);
      } catch (err) {
        rawLogger.warn(`consumer whatsmeow: varredura de ${lane.key} falhou: ${errorText(err)}`);
      }
    }
  }

  /** Pega para este consumidor as pendentes paradas há `minIdle` (de `consumer`, se dado) e enfileira. */
  private async claim(lane: Lane, minIdle: number, consumer?: string): Promise<void> {
    let start = "-";
    for (let round = 0; round < 20 && !this.stopping && lane.active; round += 1) {
      const args = ["XPENDING", lane.key, this.opts.group, "IDLE", String(minIdle), start, "+", String(this.opts.batchSize)];
      if (consumer) args.push(consumer);
      // eslint-disable-next-line no-await-in-loop
      const rows = (await this.redis.call(...(args as [string, ...string[]]))) as [string, string, number, number][];
      if (!rows || !rows.length) return;
      const candidates = rows.filter(([id]) => !lane.known.has(id));
      if (candidates.length) {
        // eslint-disable-next-line no-await-in-loop
        const claimed = (await this.redis.call(
          "XCLAIM",
          lane.key,
          this.opts.group,
          this.name,
          String(minIdle),
          ...candidates.map(([id]) => id)
        )) as ([string, string[] | null] | null)[];
        const deliveries = new Map(candidates.map(([id, , , count]) => [id, Number(count) + 1]));
        const returned = new Set<string>();
        for (const item of claimed || []) {
          if (!item || !item[1]) continue;
          returned.add(item[0]);
          this.enqueue(lane, { id: item[0], fields: item[1], deliveries: deliveries.get(item[0]) || 1 });
        }
        const lost = candidates.filter(([id]) => !returned.has(id) && !lane.known.has(id));
        if (lost.length) {
          // Apagadas pela retenção do gateway antes de confirmadas (o Redis já
          // as tirou da lista de pendentes) ou pegas por outro consumidor.
          rawLogger.warn(`consumer whatsmeow: ${lost.length} pendente(s) de ${lane.key} não recuperada(s) (retenção ou outro consumidor)`);
        }
      }
      if (rows.length < this.opts.batchSize || lane.items.length >= this.opts.laneHighWater) return;
      start = `(${rows[rows.length - 1][0]}`;
    }
  }

  /** Cada deploy usa um nome novo (hostname-pid): limpa os antigos sem pendentes. */
  private async forgetStaleConsumers(lane: Lane): Promise<void> {
    const consumers = ((await this.redis.call("XINFO", "CONSUMERS", lane.key, this.opts.group)) as any[][]) || [];
    for (const row of consumers) {
      const info = pairs(row);
      if (info.name !== this.name && Number(info.pending) === 0 && Number(info.idle) > this.opts.staleConsumerMs) {
        // eslint-disable-next-line no-await-in-loop
        await this.redis.call("XGROUP", "DELCONSUMER", lane.key, this.opts.group, String(info.name));
      }
    }
  }

  // --- métricas ---

  private async laneStats(lane: Lane, now: number): Promise<ConnectionStats> {
    const base = { connectionId: lane.connectionId, stream: lane.key, queued: lane.items.length };
    try {
      const groups = ((await this.redis.call("XINFO", "GROUPS", lane.key)) as any[][]) || [];
      const group = groups.map(pairs).find(g => g.name === this.opts.group);
      if (!group) return { ...base, pending: 0, lag: null, lagMs: 0 };
      const pending = Number(group.pending) || 0;
      const lag = group.lag === null || group.lag === undefined ? null : Number(group.lag);
      let oldest: string | null = null;
      if (pending > 0) {
        const summary = (await this.redis.call("XPENDING", lane.key, this.opts.group)) as any[];
        oldest = summary?.[1] || null;
      } else if (lag === null || lag > 0) {
        const next = (await this.redis.call(
          "XRANGE",
          lane.key,
          `(${group["last-delivered-id"]}`,
          "+",
          "COUNT",
          "1"
        )) as [string, string[]][];
        oldest = next?.[0]?.[0] || null;
      }
      return { ...base, pending, lag, lagMs: oldest ? Math.max(0, now - idMs(oldest)) : 0 };
    } catch (err) {
      rawLogger.warn(`consumer whatsmeow: métricas de ${lane.key} falharam: ${errorText(err)}`);
      return { ...base, pending: 0, lag: null, lagMs: 0 };
    }
  }
}

let current: StreamConsumer | null = null;

/** Começa a ler os streams das conexões dadas (motor whatsmeow). Chamar de novo reinicia. */
export const startConsumer = async (connectionIds: number[], deps: ConsumerDeps = {}): Promise<void> => {
  if (current) await stopConsumer();
  const consumer = new StreamConsumer(deps);
  current = consumer;
  await consumer.start(connectionIds);
};

/** Conexão criada (ou reativada): passa a ler o stream dela. */
export const addConnection = async (connectionId: number): Promise<void> => {
  if (current) await current.add(connectionId);
};

/** Conexão excluída: para de ler o stream dela (os dados no Redis ficam). */
export const removeConnection = async (connectionId: number): Promise<void> => {
  if (current) current.remove(connectionId);
};

/** Desligamento: para de ler e espera os handlers em andamento (até o timeout). */
export const stopConsumer = async (options: { timeoutMs?: number } = {}): Promise<void> => {
  const consumer = current;
  if (!consumer) return;
  current = null;
  await consumer.stop(options.timeoutMs);
};

/** Pendentes, atraso e dead letters para o Monitor do servidor. */
export const consumerStats = async (): Promise<ConsumerStats> => {
  if (!current) {
    return { running: false, consumer: null, pending: 0, lagMs: 0, deadLetters: 0, connections: [] };
  }
  return current.stats();
};
