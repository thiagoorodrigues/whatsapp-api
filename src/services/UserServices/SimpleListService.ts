import User from "../../models/User";
import AppError from "../../errors/AppError";
import Queue from "../../models/Queue";
import sequelize from "../../database";
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

export const ListServiceRelatorio = async ({ companyId, DataFinal, DataInicial, User }: Params): Promise<{ nome: string, id: number | string, totalabertos: string, totalfechados: string, totalpendentes: string }[]> => {

  let queryToUser = `
   select
        u."name" as Nome,
        u."id" as Id,
        (
        select
          COUNT(*)
        from
          "TicketTraking" tt
        join "Tickets" t on
          t."id" = tt."ticketId"
        where
          tt."userId" = u.id
          and t."status" = 'open'
          ${!!DataInicial && DataInicial != "" ? ` and tt."startedAt"::DATE>='${DataInicial} 00:00:01'` : ''}${!!DataFinal && DataFinal != "" ? ` and tt."startedAt"::DATE<='${DataFinal} 23:59:59'` : ''}
        ) as totalabertos,
        (
        select
          COUNT(*)
        from
          "TicketTraking" tt
        join "Tickets" t on
          t."id" = tt."ticketId"
        where
          tt."userId" = u.id
          and t."status" = 'closed'
          ${!!DataInicial && DataInicial != "" ? ` and tt."startedAt"::DATE>='${DataInicial} 00:00:01'` : ''}${!!DataFinal && DataFinal != "" ? ` and tt."startedAt"::DATE<='${DataFinal} 23:59:59'` : ''}
        ) as totalfechados,
        (
        select
          COUNT(*)
        from
          "TicketTraking" tt
        join "Tickets" t on
          t."id" = tt."ticketId"
        where
          tt."userId" = u.id
          and t."status" = 'pending'
          and tt."startedAt" IS NULL
        ) as totalpendentes
      from
        "Users" u
      where
        u."companyId" = ${companyId} ${!!User && User !== "" ? `AND u."name" LIKE '%` + User + `%'` : ''}`;


  const users: any = await sequelize.query(queryToUser);

  if (!users) {
    throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  let newUsers: any[] = [];

  if (!!users && !!users[0]) {

    for await (const usr of users[0]) {
      let queryTouse = `
        select
      	  avg(coalesce(
          (date_part('day', AGE(tt."startedAt", tt."queuedAt"))* 24 * 60) +
          (date_part('hour', AGE(tt."startedAt", tt."queuedAt"))* 60) +
          (date_part('minutes', AGE(tt."startedAt", tt."queuedAt"))), 0)) as avgWaitTime,
          avg(COALESCE(
          (date_part('day', AGE(COALESCE(tt."ratingAt", tt."finishedAt") , tt."startedAt"))* 24 * 60) +
          (date_part('hour', AGE(COALESCE(tt."ratingAt", tt."finishedAt"), tt."startedAt"))* 60) +
          (date_part('minutes', AGE(coalesce(tt."ratingAt", tt."finishedAt"), tt."startedAt"))), 0)) as supportTime,
          COALESCE(avg(ur.rate), 0) rating
        from "TicketTraking" tt
        left join "UserRatings" ur on
	      ur."userId" = ${usr.id}
        where
        tt."userId" = ${usr.id}`;

      let queryTransferencias = `select COUNT(*) as transferencias from "TicketTraking" tt where "oldUserId" = '${usr.id}'`

      if (!!DataInicial && DataInicial != "") {
        queryTouse += ` and tt."createdAt"::DATE>='${DataInicial} 00:00:01'`;
        queryTransferencias += ` and tt."createdAt"::DATE>='${DataInicial} 00:00:01'`;
      }

      if (!!DataFinal && DataFinal != "") {
        queryTouse += ` and tt."createdAt"::DATE<='${DataFinal} 23:59:59'`;
        queryTransferencias += ` and tt."createdAt"::DATE<='${DataFinal} 23:59:59'`;
      }

      const dados: any[] = await sequelize.query(queryTouse);
      const dadosTransferencias: any[] = await sequelize.query(queryTransferencias);

      newUsers.push({ ...usr, tmpr: dados[0][0].avgwaittime, tma: dados[0][0].supporttime, rating: dados[0][0].rating, transferidos: dadosTransferencias[0][0].transferencias })
    }
  }

  return newUsers as { nome: string, id: number | string, totalabertos: string, totalfechados: string, totalpendentes: string, tmpr: string | number, rating: string | number }[];
};

export default SimpleListService;
