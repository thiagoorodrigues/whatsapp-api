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
// - XACK só depois que o handler termina sem lançar. Falha segura a fila da
//   conexão (head-of-line): a mesma entrada é tentada de novo depois de 1 s,
//   3 s, 10 s e 30 s, antes das seguintes, para que uma reação/recibo nunca
//   rode antes da mensagem de que depende nem um evento `connection` antigo
//   seja aplicado depois de um novo. Antes de cada nova tentativa,
//   `XCLAIM ... 0 <id>` grava o contador de entregas no Redis e zera o idle
//   (a varredura não pega a entrada). Na 5ª entrega sem sucesso: XADD wa:dead
//   (`stream`, `id`, `e`, `error`, + `connectionId`, `deliveries`) + XACK +
//   Log do sistema com protocolo, e a fila segue. Envelope ilegível vai
//   direto para wa:dead.
// - Handler que passa de `handlerTimeoutMs` não é abandonado: só gera aviso
//   (e um XCLAIM JUSTID para zerar o idle); a fila espera a promessa terminar
//   e o resultado dela decide (XACK ou nova tentativa). Abandonar e rodar de
//   novo arriscaria o mesmo evento em paralelo consigo mesmo.
//
// Invariante: uma instância da api por vez (atualização stop-first do Swarm).
// Cada deploy usa um nome de consumidor novo (hostname-pid); ao começar a ler
// um stream, o consumer pega os pendentes de TODOS os consumidores do grupo
// (XPENDING completo + XCLAIM com min-idle 0, em ordem de id) e os processa
// antes da primeira leitura com ">". Com duas instâncias vivas ao mesmo tempo
// elas tomariam as entradas uma da outra.
//
// A varredura periódica (XPENDING IDLE + XCLAIM, entradas paradas há
// `claimMinIdleMs`) fica só para recuperar quedas no meio do caminho; o que
// ela pega entra na fila na ordem do id do stream. Usa XPENDING + XCLAIM em
// vez de XAUTOCLAIM porque precisa do contador de entregas (o XAUTOCLAIM não
// devolve) e não pode tomar de volta uma entrada que ainda roda aqui.

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
  /** Esperas entre tentativas da mesma entrada (a última se repete). */
  retryDelaysMs?: number[];
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
  /** Só lê com ">" depois de pegar os pendentes do grupo. */
  ready: boolean;
  /** Acorda a espera entre tentativas (removeConnection, desligamento). */
  wake: (() => void) | null;
  /** Muda a cada attach: uma tentativa antiga em segundo plano desiste. */
  attachRun: number;
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

const idParts = (id: string): [number, number] => {
  const [ms, seq] = String(id).split("-");
  return [Number(ms) || 0, Number(seq) || 0];
};

const compareIds = (a: string, b: string): number => {
  const [am, as] = idParts(a);
  const [bm, bs] = idParts(b);
  return am - bm || as - bs;
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
      retryDelaysMs: deps.retryDelaysMs && deps.retryDelaysMs.length ? deps.retryDelaysMs : [1000, 3000, 10000, 30000],
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
    lane.ready = false;
    lane.wake?.();
    this.interrupt();
  }

  async stop(timeoutMs = this.opts.stopTimeoutMs): Promise<void> {
    this.stopping = true;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    this.lanes.forEach(lane => lane.wake?.());
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
        worker: null,
        ready: false,
        wake: null,
        attachRun: 0
      };
      this.lanes.set(connectionId, lane);
    }
    lane.active = true;
    lane.ready = false;
    lane.attachRun += 1;
    const run = lane.attachRun;
    if (await this.prepare(lane)) {
      lane.ready = lane.active;
      return;
    }
    // Redis fora: não lê com ">" antes de pegar os pendentes; tenta de novo
    // em segundo plano, com backoff, sem travar a partida da api.
    this.retryPrepare(lane, run);
  }

  /**
   * Cria o grupo e pega para este consumidor os pendentes de TODOS os
   * consumidores (deploy novo = nome novo, reinício, conexão que voltou),
   * antes da primeira leitura com ">", para manter a ordem. Vale pela
   * invariante de uma instância por vez. Só conta como pronto quando o
   * XPENDING não mostra mais nada com outro consumidor.
   */
  private async prepare(lane: Lane): Promise<boolean> {
    try {
      await this.ensureGroup(lane.key);
      for (let pass = 0; pass < 3 && lane.active && !this.stopping; pass += 1) {
        // eslint-disable-next-line no-await-in-loop
        await this.claim(lane, 0, { full: true });
        // eslint-disable-next-line no-await-in-loop
        const summary = (await this.redis.call("XPENDING", lane.key, this.opts.group)) as any[];
        const owners = ((summary?.[3] as [string, string][]) || []).filter(
          ([name, count]) => name !== this.name && Number(count) > 0
        );
        if (!owners.length) return true;
      }
      throw new Error("ainda há pendentes com outro consumidor");
    } catch (err) {
      logger.warn(`consumer whatsmeow: falha ao preparar ${lane.key}: ${errorText(err)}`);
      return false;
    }
  }

  private async retryPrepare(lane: Lane, run: number): Promise<void> {
    let backoff = 500;
    const current = () => lane.active && !this.stopping && lane.attachRun === run;
    while (current()) {
      const until = Date.now() + backoff;
      // eslint-disable-next-line no-await-in-loop
      while (current() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
      if (!current()) return;
      // eslint-disable-next-line no-await-in-loop
      if (await this.prepare(lane)) {
        if (current()) {
          lane.ready = true;
          this.interrupt();
        }
        return;
      }
      backoff = Math.min(backoff * 2, 10000);
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
      const lanes = [...this.lanes.values()].filter(l => l.active && l.ready && l.items.length < this.opts.laneHighWater);
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
          if (lane && lane.active && lane.ready) for (const [id, fields] of entries) this.enqueue(lane, { id, fields: fields || [], deliveries: 1 });
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
    // Na ordem do id: pendentes recuperados pela varredura podem ser mais
    // antigos que entradas já na fila.
    let at = lane.items.length;
    while (at > 0 && compareIds(lane.items[at - 1].id, entry.id) > 0) at -= 1;
    lane.items.splice(at, 0, entry);
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
    let { deliveries } = entry;
    for (let attempt = 0; ; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const error = await this.runHandler(lane, entry.id, env);
      if (error === null) {
        // eslint-disable-next-line no-await-in-loop
        await this.ack(lane, entry.id);
        return;
      }
      if (deliveries >= max) {
        // eslint-disable-next-line no-await-in-loop
        await this.deadLetter(lane, { ...entry, deliveries }, raw, error);
        return;
      }
      rawLogger.warn(
        `consumer whatsmeow: ${lane.key} ${entry.id} (${env.type}) falhou na tentativa ${deliveries}/${max}: ${errorText(error)}`
      );
      // Espera e toma a entrada de novo; sai se a conexão saiu ou a api está
      // desligando (a entrada fica pendente e volta no próximo attach).
      // eslint-disable-next-line no-await-in-loop
      const next = await this.reclaim(lane, entry.id, attempt);
      if (next === null) return;
      deliveries = next;
    }
  }

  /** Roda o handler até a promessa terminar; devolve o erro ou null. */
  private async runHandler(lane: Lane, id: string, env: GatewayEnvelope): Promise<unknown | null> {
    const timer = setTimeout(() => {
      logger.warn(
        `consumer whatsmeow: handler de ${lane.key} ${id} (${env.type}) passou de ${this.opts.handlerTimeoutMs} ms; a fila espera ele terminar`
      );
      // Zera o idle sem contar entrega: a varredura não toma a entrada.
      this.redis.call("XCLAIM", lane.key, this.opts.group, this.name, "0", id, "JUSTID").catch(() => undefined);
    }, this.opts.handlerTimeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    try {
      await this.opts.handle(env);
      return null;
    } catch (err) {
      return err ?? new Error("handler falhou");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Espera o backoff e faz `XCLAIM ... 0 <id>` (conta a entrega e zera o idle).
   * Devolve o novo contador de entregas, ou null para largar a entrada
   * (conexão removida, desligamento, entrada que sumiu do stream).
   */
  private async reclaim(lane: Lane, id: string, attempt: number): Promise<number | null> {
    const delays = this.opts.retryDelaysMs;
    const gone = () => !lane.active || this.stopping;
    for (let step = attempt; ; step += 1) {
      if (gone()) return null;
      // eslint-disable-next-line no-await-in-loop
      await this.lanePause(lane, delays[Math.min(step, delays.length - 1)]);
      if (gone()) return null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const claimed = (await this.redis.call("XCLAIM", lane.key, this.opts.group, this.name, "0", id)) as any[];
        if (!claimed || !claimed.length || !claimed[0]) {
          rawLogger.warn(`consumer whatsmeow: ${lane.key} ${id} não está mais pendente (retenção do stream?)`);
          return null;
        }
        // eslint-disable-next-line no-await-in-loop
        const rows = (await this.redis.call("XPENDING", lane.key, this.opts.group, id, id, "1")) as any[][];
        // Removida/desligando durante os comandos: não roda o handler de novo.
        if (gone()) return null;
        return Number(rows?.[0]?.[3]) || attempt + 2;
      } catch (err) {
        // Redis fora: espera mais e tenta tomar de novo, sem rodar o handler.
        rawLogger.warn(`consumer whatsmeow: XCLAIM de ${lane.key} ${id} falhou: ${errorText(err)}`);
      }
    }
  }

  private lanePause(lane: Lane, ms: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        lane.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      if (typeof timer.unref === "function") timer.unref();
      lane.wake = done;
    });
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
      "e",
      raw ?? "",
      "error",
      error,
      "connectionId",
      String(lane.connectionId),
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
      // Durante o attach quem pega os pendentes é o prepare.
      if (!lane.active || !lane.ready || this.stopping) continue;
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

  /**
   * Pega para este consumidor as pendentes paradas há `minIdle` e enfileira,
   * em páginas na ordem do id. `full` (attach): vai até o fim, sem limite de
   * rodadas nem da fila local, porque o ">" só começa depois.
   */
  private async claim(lane: Lane, minIdle: number, { full = false } = {}): Promise<void> {
    let start = "-";
    for (let round = 0; (full || round < 20) && !this.stopping && lane.active; round += 1) {
      const args = ["XPENDING", lane.key, this.opts.group, "IDLE", String(minIdle), start, "+", String(this.opts.batchSize)];
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
      if (rows.length < this.opts.batchSize || (!full && lane.items.length >= this.opts.laneHighWater)) return;
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
