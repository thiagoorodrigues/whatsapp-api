import { QueryTypes } from "sequelize";
import sequelize from "../../database";

const SummarySystemLogsService = async () => {
  const [row]: any[] = await sequelize.query(
    `SELECT count(*) FILTER (WHERE level = 'error') AS errors,
            count(*) FILTER (WHERE level = 'warn') AS warnings,
            count(*) FILTER (WHERE source = 'api' AND status IS NOT NULL) AS requests,
            round(avg("durationMs") FILTER (WHERE source = 'api' AND "durationMs" IS NOT NULL)) AS "avgMs"
       FROM "SystemLogs"
      WHERE "createdAt" >= :since`,
    { replacements: { since: new Date(Date.now() - 24 * 3600 * 1000) }, type: QueryTypes.SELECT }
  );
  return {
    errors: Number(row?.errors || 0),
    warnings: Number(row?.warnings || 0),
    requests: Number(row?.requests || 0),
    avgMs: row?.avgMs === null || row?.avgMs === undefined ? null : Number(row.avgMs)
  };
};

export default SummarySystemLogsService;
