import { Op, Includeable, WhereOptions, literal, where as sqlWhere } from "sequelize";
import { startOfDay, endOfDay, parseISO } from "date-fns";

import TicketTraking from "../../models/TicketTraking";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import User from "../../models/User";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { toTicketReportRow } from "../ReportService/trackingRules";

interface Request {
  tipoData?: string;
  dataInicial?: string;
  dataFinal?: string;
  ticket?: string;
  connections?: string[];
  cliente?: string;
  usuario?: string;
  queues?: string[];
  status?: string;
  userId: string | number;
  profile?: string;
  companyId: number;
  pageNumber: string;
}

interface Response {
  tickets: ReturnType<typeof toTicketReportRow>[];
  count: number;
  hasMore: boolean;
}

// Columns of the TicketTraking row as aliased by findAndCountAll.
const col = (name: string) => `"TicketTraking"."${name}"`;
const ENTRY_DATE = `coalesce(${col("queuedAt")}, ${col("startedAt")}, ${col("createdAt")})`;

const STATUS_CONDITION: Record<string, string> = {
  closed: `${col("finishedAt")} is not null`,
  open: `${col("finishedAt")} is null and ${col("startedAt")} is not null`,
  pending: `${col("finishedAt")} is null and ${col("startedAt")} is null`
};

const asList = (value?: string[] | string) =>
  (Array.isArray(value) ? value : value ? [value] : []).filter(v => `${v}` !== "");

/**
 * Ticket report with one row per attendance (TicketTraking), so a contact
 * attended three times by different people shows three rows, each with its
 * own attendant and dates. Admins see every attendance; other profiles see
 * their own plus the ones still waiting in the queue.
 */
const ListTicketsRelatorioService = async ({
  pageNumber = "1",
  userId,
  profile,
  companyId,
  ticket,
  tipoData,
  dataInicial,
  dataFinal,
  connections,
  cliente,
  usuario,
  queues,
  status
}: Request): Promise<Response> => {
  const and: any[] = [{ companyId }];

  if (profile !== "admin") {
    and.push({
      [Op.or]: [{ userId }, literal(STATUS_CONDITION.pending)]
    });
  }

  if (ticket) and.push({ ticketId: ticket });

  const connectionIds = asList(connections);
  if (connectionIds.length) and.push({ whatsappId: { [Op.in]: connectionIds } });

  if (status && STATUS_CONDITION[status]) {
    and.push(literal(STATUS_CONDITION[status]));
  }

  // "Data Fechamento" filters by when the attendance ended; anything else by
  // when it entered the system.
  const dateColumn = tipoData === "DataFechamento" ? col("finishedAt") : ENTRY_DATE;
  if (dataInicial) {
    and.push(
      sqlWhere(literal(dateColumn), {
        [Op.gte]: startOfDay(parseISO(dataInicial))
      })
    );
  }
  if (dataFinal) {
    and.push(
      sqlWhere(literal(dateColumn), {
        [Op.lte]: endOfDay(parseISO(dataFinal))
      })
    );
  }

  const queueIds = asList(queues);
  const ticketWhere: WhereOptions = queueIds.length
    ? { queueId: { [Op.in]: queueIds } }
    : {};

  const include: Includeable[] = [
    {
      model: Ticket,
      as: "ticket",
      required: true,
      where: ticketWhere,
      attributes: ["id", "uuid", "queueId", "status"],
      include: [
        {
          model: Contact,
          as: "contact",
          attributes: ["id", "name", "number", "email", "profilePicUrl"],
          ...(cliente
            ? { where: { name: { [Op.iLike]: `%${cliente}%` } }, required: true }
            : {})
        },
        { model: Queue, as: "queue", attributes: ["id", "name", "color"] },
        { model: Tag, as: "tags", attributes: ["id", "name", "color"] },
        { model: Whatsapp, as: "whatsapp", attributes: ["name"] }
      ]
    },
    {
      model: User,
      as: "user",
      attributes: ["id", "name"],
      ...(usuario
        ? { where: { name: { [Op.iLike]: `%${usuario}%` } }, required: true }
        : { required: false })
    },
    { model: Whatsapp, as: "whatsapp", attributes: ["name"] }
  ];

  const limit = 40;
  const offset = limit * (+pageNumber - 1);

  const { count, rows } = await TicketTraking.findAndCountAll({
    where: { [Op.and]: and },
    include,
    distinct: true,
    limit,
    offset,
    order: [["id", "DESC"]],
    subQuery: false
  });

  return {
    tickets: rows.map(row => toTicketReportRow(row.get({ plain: true }))),
    count,
    hasMore: count > offset + rows.length
  };
};

export default ListTicketsRelatorioService;
