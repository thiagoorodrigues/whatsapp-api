import { Op } from "sequelize";
import ServerMetric from "../../models/ServerMetric";
import { MetricsSnapshot, readServerMetrics } from "./readServerMetrics";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const clampHours = (raw: unknown): number => {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(n, 168);
};

// Pega uma a cada k linhas para caber em `max` pontos; o último ponto sempre
// entra, para o gráfico terminar na leitura mais recente.
export const downsample = <T>(rows: T[], max = 300): T[] => {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / (max - 1));
  const out = rows.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
};

export const averageCpu = (rows: { cpuPercent: number | null }[]): number | null => {
  const values = rows.map(r => r.cpuPercent).filter((v): v is number => v !== null && v !== undefined);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + Number(b), 0) / values.length) * 10) / 10;
};

export const recordServerMetrics = async (
  read: () => Promise<MetricsSnapshot> = () => readServerMetrics()
): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cpuCount, ...row } = await read();
  await ServerMetric.create(row as any);
};

export const purgeServerMetrics = async (now = new Date()): Promise<number> =>
  ServerMetric.destroy({ where: { createdAt: { [Op.lt]: new Date(now.getTime() - 7 * DAY) } } });

export const getMetricsHistory = async (hours: number, now = new Date()): Promise<object[]> =>
  ServerMetric.findAll({
    where: { createdAt: { [Op.gte]: new Date(now.getTime() - hours * HOUR) } },
    order: [["createdAt", "ASC"]],
    raw: true
  });

export const getCpuAverage5 = async (now = new Date()): Promise<number | null> => {
  const rows = await ServerMetric.findAll({
    attributes: ["cpuPercent"],
    where: { createdAt: { [Op.gte]: new Date(now.getTime() - 5 * MINUTE) } },
    raw: true
  });
  return averageCpu(rows as any);
};
