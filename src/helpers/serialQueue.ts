// Fila de promessas: uma tarefa por vez, na ordem de chegada. Usada por
// conexão do WhatsApp para processar os eventos de mensagem sem corrida.

type Task = () => Promise<unknown>;

interface Options {
  backlogThreshold?: number;
  onBacklog?: (size: number) => void;
  onError?: (err: Error) => void;
}

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
    if (this.pending >= threshold && this.options.onBacklog) this.options.onBacklog(this.pending);
    this.tail = this.tail
      .then(() => task())
      .catch(err => {
        if (this.options.onError) this.options.onError(err as Error);
      })
      .then(() => {
        this.pending -= 1;
      });
  }

  idle(): Promise<void> {
    return this.tail;
  }
}

const queues = new Map<number, SerialQueue>();

export const queueFor = (whatsappId: number, options: Options = {}): SerialQueue => {
  let queue = queues.get(whatsappId);
  if (!queue) {
    queue = new SerialQueue(`whatsapp-${whatsappId}`, options);
    queues.set(whatsappId, queue);
  }
  return queue;
};
