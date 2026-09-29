// Regras dos crons de minuto: quais conexões realmente têm algo configurado.

export const expiringWhatsapps = <T extends { expiresTicket?: unknown }>(list: T[]): T[] =>
  list.filter(w => Number(w.expiresTicket) > 0);

export const transferringWhatsapps = <T extends { timeToTransfer?: unknown; transferQueueId?: unknown }>(
  list: T[]
): T[] =>
  list.filter(
    w => Number(w.timeToTransfer) > 0 && w.transferQueueId !== null && w.transferQueueId !== undefined
  );
