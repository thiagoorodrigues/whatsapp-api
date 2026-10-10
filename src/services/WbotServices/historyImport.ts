import { SerialQueue } from "../../helpers/serialQueue";

// Importação do histórico que o WhatsApp manda em lotes logo após a leitura
// do QR Code. O WhatsApp não avisa qual é o último lote: a importação termina
// quando a fila esvazia e nenhum lote novo chega em `idleMs`.

interface HistoryMessage {
  key: { id?: string | null; remoteJid?: string | null };
  messageTimestamp?: number | string | { toNumber(): number } | null;
}

interface ImportSettings {
  importMessages: boolean;
  initialDate: string | null;
  finalDate: string | null;
}

// Shown on the connection card while importing.
export interface ImportProgress {
  status: "running" | "done";
  // How much of the history WhatsApp says it has sent (0-100), when known.
  receivedPercent: number | null;
  total: number;
  processed: number;
  saved: number;
  existing: number;
  outside: number;
  failed: number;
  conversations: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface HistoryImportDeps<M extends HistoryMessage> {
  load: () => Promise<ImportSettings>;
  exists: (messageId: string) => Promise<boolean>;
  handle: (message: M) => Promise<void>;
  finish: () => Promise<void>;
  log: (line: string) => void;
  pauseMs?: number;
  idleMs?: number;
  report?: (progress: ImportProgress) => void;
  reportEveryMs?: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Coluna DATEONLY: o Sequelize devolve "AAAA-MM-DD", mas o model tipa como Date.
export const importDay = (value: unknown): string | null => {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
};

// As datas da tela são dias de Brasília; os dois dias entram inteiros.
export const importWindow = (initialDate: string | null, finalDate: string | null): { from: number; to: number } | null => {
  if (!initialDate || !DAY.test(initialDate)) return null;
  const from = new Date(`${initialDate}T00:00:00.000-03:00`).getTime();
  const to = finalDate && DAY.test(finalDate) ? new Date(`${finalDate}T23:59:59.999-03:00`).getTime() : Infinity;
  return Number.isNaN(from) ? null : { from, to };
};

const timestampMs = (m: HistoryMessage): number => {
  const t = m.messageTimestamp as any;
  const seconds = typeof t === "object" && t && typeof t.toNumber === "function" ? t.toNumber() : Number(t);
  return seconds * 1000;
};

const pause = (ms: number) => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

export const createHistoryImporter = <M extends HistoryMessage>(deps: HistoryImportDeps<M>) => {
  const pauseMs = deps.pauseMs ?? 300;
  const idleMs = deps.idleMs ?? 10 * 60 * 1000;
  // Um lote grande leva muitos minutos; o limite da tarefa não pode cortá-lo.
  const queue = new SerialQueue("history", {
    onError: err => deps.log(`erro no lote de histórico: ${err?.message || err}`),
    taskTimeoutMs: 6 * 60 * 60 * 1000
  });
  let pending = 0;
  let idleTimer: NodeJS.Timeout | undefined;
  const reportEveryMs = deps.reportEveryMs ?? 1500;
  let progress: ImportProgress | null = null;
  let receivedPercent: number | null = null;
  let chats = new Set<string>();
  let lastReport = 0;

  const report = (force = false) => {
    if (!progress || !deps.report) return;
    const now = Date.now();
    if (!force && now - lastReport < reportEveryMs) return;
    lastReport = now;
    deps.report({ ...progress, receivedPercent, conversations: chats.size });
  };

  // A new import starts when a batch arrives after the previous one was done.
  const ensureProgress = (): ImportProgress => {
    if (!progress || progress.status === "done") {
      chats = new Set();
      progress = {
        status: "running",
        receivedPercent: null,
        total: 0,
        processed: 0,
        saved: 0,
        existing: 0,
        outside: 0,
        failed: 0,
        conversations: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null
      };
    }
    return progress;
  };

  const stopTimer = () => clearTimeout(idleTimer);

  const importBatch = async (messages: M[]) => {
    const settings = await deps.load();
    if (!settings.importMessages) return false;

    const window = importWindow(settings.initialDate, settings.finalDate);
    if (!window) {
      deps.log(`lote de ${messages.length} mensagens ignorado: importação sem data inicial`);
      return true;
    }

    const p = ensureProgress();
    p.total += messages.length;
    report(true);

    let saved = 0;
    let existing = 0;
    let outside = 0;
    let failed = 0;
    for (const message of messages) {
      const id = message.key?.id;
      const ts = timestampMs(message);
      if (!id || !(ts >= window.from && ts <= window.to)) {
        outside += 1;
        p.outside += 1;
      } else if (await deps.exists(id)) {
        existing += 1;
        p.existing += 1;
      } else {
        try {
          await deps.handle(message);
          saved += 1;
          p.saved += 1;
          if (message.key?.remoteJid) chats.add(message.key.remoteJid);
        } catch (err) {
          failed += 1;
          p.failed += 1;
          deps.log(`mensagem ${id} do histórico não gravada: ${(err as Error)?.message || err}`);
        }
        await pause(pauseMs);
      }
      p.processed += 1;
      report();
    }
    report(true);
    deps.log(
      `lote de ${messages.length} mensagens: ${saved} gravadas, ${existing} já existiam, ${outside} fora do período` +
        (failed ? `, ${failed} com erro` : "")
    );
    return true;
  };

  // `prepare` (ex.: salvar os contatos do lote) roda na fila, antes das
  // mensagens do mesmo lote, mesmo com a importação desligada.
  const onBatch = (messages: M[], prepare?: () => Promise<void>, received?: number | null) => {
    stopTimer();
    if (typeof received === "number") receivedPercent = Math.max(receivedPercent ?? 0, Math.min(100, received));
    pending += 1;
    queue.push(async () => {
      let active = false;
      try {
        if (prepare) {
          await prepare().catch(err => deps.log(`erro ao preparar o lote: ${err?.message || err}`));
        }
        active = await importBatch(messages);
      } finally {
        pending -= 1;
        // Só conta o tempo ocioso quando não há outro lote esperando.
        if (active && pending === 0) {
          stopTimer();
          idleTimer = setTimeout(() => {
            if (progress) {
              progress.status = "done";
              progress.finishedAt = new Date().toISOString();
              report(true);
            }
            receivedPercent = null;
            deps.finish().catch(err => deps.log(`erro ao concluir a importação: ${err?.message || err}`));
          }, idleMs);
        }
      }
    });
  };

  // WhatsApp said the history sync is complete.
  const receivedAll = () => {
    receivedPercent = 100;
    report(true);
  };

  const snapshot = (): ImportProgress | null =>
    progress ? { ...progress, receivedPercent, conversations: chats.size } : null;

  return { onBatch, cancel: stopTimer, idle: () => queue.idle(), receivedAll, snapshot };
};
