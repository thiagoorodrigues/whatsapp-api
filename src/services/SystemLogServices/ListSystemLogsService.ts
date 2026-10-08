import { Op, WhereOptions } from "sequelize";
import SystemLog from "../../models/SystemLog";
import Company from "../../models/Company";
import User from "../../models/User";

interface Filters {
  level?: string;
  source?: string;
  companyId?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  pageNumber?: string;
}

const PAGE = 50;
const LEVELS = ["info", "warn", "error"];
const SOURCES = ["api", "job", "web"];

const validDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
const validInt = (value?: string): number | undefined => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(n) ? n : undefined;
};

const ListSystemLogsService = async (filters: Filters) => {
  const where: any = {};
  if (filters.level && LEVELS.includes(filters.level)) where.level = filters.level;
  if (filters.source && SOURCES.includes(filters.source)) where.source = filters.source;
  const companyId = validInt(filters.companyId);
  if (companyId !== undefined) where.companyId = companyId;
  const status = validInt(filters.status);
  if (status !== undefined) where.status = status;

  const from = validDate(filters.from) || new Date(Date.now() - 3600 * 1000);
  const to = validDate(filters.to);
  where.createdAt = { [Op.gte]: from, ...(to ? { [Op.lte]: to } : {}) };

  const search = (filters.search || "").trim();
  if (search) {
    const like = `%${search}%`;
    where[Op.or] = [
      { protocol: { [Op.iLike]: like } },
      { code: { [Op.iLike]: like } },
      { route: { [Op.iLike]: like } },
      { message: { [Op.iLike]: like } }
    ];
  }

  const page = Math.max(validInt(filters.pageNumber) || 1, 1);
  const rows = await SystemLog.findAll({
    where: where as WhereOptions,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: PAGE + 1,
    offset: (page - 1) * PAGE
  });
  const logs = rows.slice(0, PAGE).map(r => r.toJSON() as any);

  const companyIds = [...new Set(logs.map(l => l.companyId).filter(Boolean))];
  const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
  const [companies, users] = await Promise.all([
    companyIds.length ? Company.findAll({ where: { id: companyIds }, attributes: ["id", "name"] }) : [],
    userIds.length ? User.findAll({ where: { id: userIds }, attributes: ["id", "name"] }) : []
  ]);
  const companyName = new Map((companies as any[]).map(c => [c.id, c.name]));
  const userName = new Map((users as any[]).map(u => [u.id, u.name]));

  return {
    hasMore: rows.length > PAGE,
    logs: logs.map(l => ({ ...l, companyName: companyName.get(l.companyId) ?? null, userName: userName.get(l.userId) ?? null }))
  };
};

export default ListSystemLogsService;
