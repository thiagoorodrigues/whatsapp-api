import User from "../../models/User";
import AppError from "../../errors/AppError";
import Queue from "../../models/Queue";
import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import {
  ENTRY_DATE_SQL,
  TRACKING_STATUS_SQL,
  minutesBetweenSql
} from "../ReportService/trackingRules";
import { logger } from "../../utils/logger";

interface Params {
  companyId: string | number;
  User?: string;
  DataInicial?: string;
  DataFinal?: string;
}

const SimpleListService = async ({ companyId }: Params): Promise<User[]> => {
  const users = await User.findAll({
    where: {
      companyId
    },
    attributes: ["name", "id", "email"],
    include: [
      { model: Queue, as: 'queues' }
    ],
    order: [["id", "ASC"]]
  });

  if (!users) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  return users;
};

export interface AttendantReportRow {
  nome: string;
  id: number;
  totalabertos: string;
  totalfechados: string;
  totalpendentes: string;
  tmpr: string | number;
  tma: string | number;
  rating: string | number;
  transferidos: string;
}

/**
 * Attendant report. Counts attendances (TicketTraking rows) by their own
 * state instead of the ticket's current status, since a contact's ticket
 * is reused and reopened by other attendants later:
 * - totalabertos ("Iniciados"): attendances the user started in the period
 * - totalfechados ("Finalizados"): attendances the user closed
 * - totalpendentes ("Enviados para fila"): returned to the queue by the user
 *   and not picked up yet
 * Period = when the attendance entered the system. Times in minutes.
 * All user input is passed as bound values.
 */
export const ListServiceRelatorio = async ({
  companyId,
  DataFinal,
  DataInicial,
  User: userName
}: Params): Promise<AttendantReportRow[]> => {
  const period: string[] = [];
  const ratingPeriod: string[] = [];
  const transferPeriod: string[] = [];
  const replacements: Record<string, any> = { companyId: Number(companyId) };

  if (DataInicial) {
    period.push(`and ${ENTRY_DATE_SQL} >= :dataInicial`);
    ratingPeriod.push('and ur."createdAt" >= :dataInicial');
    transferPeriod.push('and t2."createdAt" >= :dataInicial');
    replacements.dataInicial = `${DataInicial} 00:00:00`;
  }
  if (DataFinal) {
    period.push(`and ${ENTRY_DATE_SQL} <= :dataFinal`);
    ratingPeriod.push('and ur."createdAt" <= :dataFinal');
    transferPeriod.push('and t2."createdAt" <= :dataFinal');
    replacements.dataFinal = `${DataFinal} 23:59:59`;
  }
  let nameFilter = "";
  if (userName) {
    nameFilter = 'and u."name" ilike :userName';
    replacements.userName = `%${userName}%`;
  }

  const waitTime = minutesBetweenSql('tt."startedAt"', 'tt."queuedAt"');
  const supportTime = minutesBetweenSql('coalesce(tt."ratingAt", tt."finishedAt")', 'tt."startedAt"');

  const query = `
    select
      u."name" as nome,
      u."id" as id,
      count(tt.id) filter (where tt."startedAt" is not null) as totalabertos,
      count(tt.id) filter (where ${TRACKING_STATUS_SQL.closed}) as totalfechados,
      count(tt.id) filter (where ${TRACKING_STATUS_SQL.pending}) as totalpendentes,
      coalesce(avg(${waitTime}) filter (where tt."startedAt" is not null and tt."queuedAt" is not null), 0) as tmpr,
      coalesce(avg(${supportTime}) filter (where tt."startedAt" is not null and tt."finishedAt" is not null), 0) as tma,
      (
        select coalesce(avg(ur.rate), 0)
        from "UserRatings" ur
        where ur."userId" = u.id ${ratingPeriod.join(" ")}
      ) as rating,
      (
        select count(*)
        from "TicketTraking" t2
        where t2."oldUserId" = u.id and t2."companyId" = :companyId ${transferPeriod.join(" ")}
      ) as transferidos
    from "Users" u
    left join "TicketTraking" tt
      on tt."userId" = u.id
      and tt."companyId" = :companyId
      ${period.join(" ")}
    where u."companyId" = :companyId ${nameFilter}
    group by u.id, u."name"
    order by u."name"
  `;

  const rows = await sequelize.query(query, {
    replacements,
    type: QueryTypes.SELECT
  });

  return rows as AttendantReportRow[];
};

export default SimpleListService;
