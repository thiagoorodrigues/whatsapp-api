// Erros do navegador: até 30 por usuário por minuto (um loop de erro numa
// tela não enche a tabela).
const LIMIT = 30;
const WINDOW_MS = 60 * 1000;
let windows = new Map<number, { start: number; count: number }>();

export const acceptClientLog = (userId: number, now = Date.now()): boolean => {
  const current = windows.get(userId);
  if (!current || now - current.start >= WINDOW_MS) {
    windows.set(userId, { start: now, count: 1 });
    return true;
  }
  if (current.count >= LIMIT) return false;
  current.count += 1;
  return true;
};

export const resetClientLogLimiter = (): void => {
  windows = new Map();
};
