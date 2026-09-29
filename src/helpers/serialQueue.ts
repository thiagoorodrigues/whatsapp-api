// Fila de promessas: uma tarefa por vez, na ordem de chegada. Usada por
// conexão do WhatsApp para processar os eventos de mensagem sem corrida.
// A fila nunca trava: erro na tarefa, erro no onError ou tarefa que não
// termina (taskTimeoutMs) são reportados e a próxima tarefa segue.

type Task = () => Promise<unknown> | unknown;

interface Options {
  backlogThreshold?: number;
  onBacklog?: (size: number) => void;
  onError?: (err: Error) => void;
  taskTimeoutMs?: number;
}

const DEFAULT_TASK_TIMEOUT_MS = 120000;

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  private pending = 0;

  constructor(public readonly name: string, private readonly options: Options = {}) {}

  get size(): number {
    return this.pending;
  }

  push(task: Task): void {
    this.pending += 1;
    const threshold = this.options.backlogThreshold ?? 200;
    if (this.pending === threshold && this.options.onBacklog) this.options.onBacklog(this.pending);

    const run = async () => {
      try {
        await this.withTimeout(task);
      } catch (err) {
        this.report(err as Error);
      } finally {
        this.pending -= 1;
      }
    };
    this.tail = this.tail.then(run, run);
  }

  idle(): Promise<void> {
    return this.tail;
  }

  private withTimeout(task: Task): Promise<unknown> {
    const timeoutMs = this.options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    let timer: NodeJS.Timeout;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${this.name}: task timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    return Promise.race([Promise.resolve().then(task), timeout]).finally(() => clearTimeout(timer));
  }

  private report(err: Error): void {
    try {
      if (this.options.onError) this.options.onError(err);
    } catch (e) {
      // O próprio relato falhou (logger, Sentry): não pode derrubar a fila.
    }
  }
}

const queues = new Map<string | number, SerialQueue>();

// Uma fila por chave, pelo tempo de vida do processo. As opções valem só na
// criação: chamadas seguintes com a mesma chave devolvem a fila existente.
export const queueFor = (key: string | number, options: Options = {}): SerialQueue => {
  let queue = queues.get(key);
  if (!queue) {
    queue = new SerialQueue(`queue-${key}`, options);
    queues.set(key, queue);
  }
  return queue;
};
