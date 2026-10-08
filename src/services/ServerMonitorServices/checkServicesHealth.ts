import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import * as queues from "../../queues";
import { Check, QueueStatus, ServicesHealth } from "./alerts";

const HOUR = 3600 * 1000;

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const timed = async (fn: () => Promise<unknown>, ms: number): Promise<Check> => {
  const started = Date.now();
  try {
    await withTimeout(fn(), ms);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: null, error: message(err) };
  }
};

// Toda fila Bull exportada por src/queues.ts.
const allQueues = (): any[] =>
  Object.values(queues).filter((q: any) => q && typeof q.getJobCounts === "function");

const queueStatus = async (q: any, ms: number, now: Date): Promise<QueueStatus> => {
  // O conjunto de falhas do Bull é ordenado pela hora da falha: ZCOUNT conta
  // as da última hora sem carregar os jobs (as falhas nunca são removidas).
  const [counts, failedLastHour] = await Promise.all([
    withTimeout<any>(q.getJobCounts(), ms),
    withTimeout<number>(q.client.zcount(q.toKey("failed"), now.getTime() - HOUR, "+inf"), ms)
  ]);
  return {
    name: q.name,
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    delayed: counts.delayed || 0,
    failed: counts.failed || 0,
    failedLastHour: Number(failedLastHour) || 0
  };
};

export const checkServicesHealth = async (timeoutMs = 3000, now = new Date()): Promise<ServicesHealth> => {
  const list = allQueues();

  const [pg, redis, queueResults] = await Promise.all([
    // Promise.resolve: o Sequelize 5 devolve Promise do Bluebird.
    timed(() => Promise.resolve(sequelize.query("SELECT 1", { type: QueryTypes.SELECT })), timeoutMs),
    list.length
      ? timed(() => list[0].client.ping(), timeoutMs)
      : Promise.resolve<Check>({ ok: false, latencyMs: null, error: "sem filas" }),
    Promise.allSettled(list.map(q => queueStatus(q, timeoutMs, now)))
  ]);

  let dbSizeBytes: number | null = null;
  if (pg.ok) {
    try {
      const [row]: any[] = await withTimeout<any[]>(
        Promise.resolve(
          sequelize.query("SELECT pg_database_size(current_database()) AS size", { type: QueryTypes.SELECT })
        ),
        timeoutMs
      );
      dbSizeBytes = row ? Number(row.size) : null;
    } catch {
      dbSizeBytes = null;
    }
  }

  return {
    postgres: { ...pg, dbSizeBytes },
    redis,
    queues: queueResults
      .filter((r): r is PromiseFulfilledResult<QueueStatus> => r.status === "fulfilled")
      .map(r => r.value)
  };
};
