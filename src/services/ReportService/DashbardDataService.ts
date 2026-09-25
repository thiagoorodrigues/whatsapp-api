/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable camelcase */
import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import {
  buildDashboardFilter,
  DashboardFilterParams,
  minutesBetweenSql
} from "./trackingRules";

export interface DashboardData {
  counters: any;
  attendants: [];
}

export type Params = DashboardFilterParams;

export default async function DashboardDataService(
  companyId: string | number,
  params: Params
): Promise<DashboardData> {
  const query = `
    with
    traking as (
      select
        c.name "companyName",
        u.name "userName",
        u.online "userOnline",
        w.name "whatsappName",
        ct.name "contactName",
        ct.number "contactNumber",
        (tt."finishedAt" is not null) "finished",
        (tt."userId" is null and tt."finishedAt" is null) "pending",
        coalesce(${minutesBetweenSql('coalesce(tt."ratingAt", tt."finishedAt")', 'tt."startedAt"')}, 0) "supportTime",
        coalesce(${minutesBetweenSql('tt."startedAt"', 'tt."queuedAt"')}, 0) "waitTime",
        t.status,
        tt.*,
        ct."id" "contactId"
      from "TicketTraking" tt
      left join "Companies" c on c.id = tt."companyId"
      left join "Users" u on u.id = tt."userId"
      left join "Whatsapps" w on w.id = tt."whatsappId"
      left join "Tickets" t on t.id = tt."ticketId"
      left join "Contacts" ct on ct.id = t."contactId"
      -- filterPeriod
    ),
    counters as (
      select
        (select avg("supportTime") from traking where "supportTime" > 0) "avgSupportTime",
        (select avg("waitTime") from traking where "waitTime" > 0) "avgWaitTime",
        (
          select count(distinct "id")
          from "Tickets"
          where status like 'open' and "companyId" = ?
        ) "supportHappening",
        (
          select count(distinct "id")
          from "Tickets"
          where status like 'pending' and "companyId" = ?
        ) "supportPending",
        (select count(id) from traking where finished) "supportFinished",
        (
          select count(leads.id) from (
            select
              ct1.id,
              count(tt1.id) total
            from traking tt1
            left join "Tickets" t1 on t1.id = tt1."ticketId"
            left join "Contacts" ct1 on ct1.id = t1."contactId"
            group by 1
            having count(tt1.id) = 1
          ) leads
        ) "leads"
    ),
    attedants as (
      select
        u.id,
        u.name,
        coalesce(att."avgSupportTime", 0) "avgSupportTime",
        att.tickets,
        att.rating,
        att.online
      from "Users" u
      left join (
        select
          u1.id,
          u1."name",
          u1."online",
          avg(t."supportTime") "avgSupportTime",
          count(t."id") tickets,
          coalesce(avg(ur.rate), 0) rating
        from "Users" u1
        left join traking t on t."userId" = u1.id
        left join "UserRatings" ur on ur."userId" = t."userId" and ur."createdAt"::date = t."finishedAt"::date
        group by 1, 2
      ) att on att.id = u.id
      where u."companyId" = ? -- attendantFilter
      order by att.name
    )
    select
      (select coalesce(jsonb_build_object('counters', c.*)->>'counters', '{}')::jsonb from counters c) counters,
      (select coalesce(json_agg(a.*), '[]')::jsonb from attedants a) attendants;
  `;

  // Period, company and attendant filters all run over TicketTraking and use
  // bound values; see trackingRules.buildDashboardFilter.
  const { where, replacements } = buildDashboardFilter(companyId, params);

  // counters: supportHappening, supportPending
  replacements.push(companyId);
  replacements.push(companyId);
  // attendants
  replacements.push(companyId);

  let attendantFilter = "";
  const userId = parseInt(`${params.userId ?? ""}`, 10);
  if (Number.isFinite(userId)) {
    attendantFilter = 'and u."id" = ?';
    replacements.push(userId);
  }

  const finalQuery = query
    .replace("-- filterPeriod", where)
    .replace("-- attendantFilter", attendantFilter);

  const responseData: DashboardData = await sequelize.query(finalQuery, {
    replacements,
    type: QueryTypes.SELECT,
    plain: true
  });

  return responseData;
}
