import { Op } from "sequelize";
import SystemLog from "../../models/SystemLog";

const DAY = 24 * 3600 * 1000;

// Retenção: requisições (info) 7 dias; avisos e erros 30 dias.
const PurgeSystemLogsService = async (now = new Date()): Promise<number> => {
  const info = await SystemLog.destroy({ where: { level: "info", createdAt: { [Op.lt]: new Date(now.getTime() - 7 * DAY) } } });
  const problems = await SystemLog.destroy({
    where: { level: { [Op.in]: ["warn", "error"] }, createdAt: { [Op.lt]: new Date(now.getTime() - 30 * DAY) } }
  });
  return info + problems;
};

export default PurgeSystemLogsService;
