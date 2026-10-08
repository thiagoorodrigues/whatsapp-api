import { Op, fn, where, col, literal, Filterable, Includeable } from "sequelize";
import buildTicketFilters from "./buildTicketFilters";
import { startOfDay, endOfDay, parseISO } from "date-fns";

import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";
import Tag from "../../models/Tag";
import TicketTag from "../../models/TicketTag";
import { intersection } from "lodash";
import Whatsapp from "../../models/Whatsapp";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  status?: string;
  date?: string;
  updatedAt?: string;
  showAll?: string;
  userId: string;
  withUnreadMessages?: string;
  queueIds: number[];
  tags: number[];
  users: number[];
  companyId: number;
  onlyFromMe: string;
  situacao: string;
  isGroup?: string;
  unread?: string;
}

interface Response {
  tickets: Ticket[];
  count: number;
  hasMore: boolean;
}

const ListTicketsService = async ({
  searchParam = "",
  pageNumber = "1",
  queueIds,
  tags,
  users,
  status,
  date,
  updatedAt,
  showAll,
  userId,
  withUnreadMessages,
  companyId,
  onlyFromMe,
  situacao,
  isGroup,
  unread
}: Request): Promise<Response> => {

  let whereCondition: Filterable["where"] = {
    [Op.or]: [{ userId }, { status: "pending" }],
    queueId: { [Op.or]: [queueIds, null] }
  };

  let includeCondition: Includeable[];

  includeCondition = [
    {
      model: Contact,
      as: "contact",
      attributes: ["id", "name", "number", "email", "profilePicUrl"]
    },
    {
      model: Queue,
      as: "queue",
      attributes: ["id", "name", "color"]
    },
    {
      model: User,
      as: "user",
      attributes: ["id", "name"]
    },
    {
      model: Tag,
      as: "tags",
      attributes: ["id", "name", "color"]
    },
    {
      model: Whatsapp,
      as: "whatsapp",
      attributes: ["name", "color"]
    },
  ];

  if (showAll === "true") {
    whereCondition = { queueId: { [Op.or]: [queueIds, null] } };
  }

  if (status) {
    whereCondition = {
      ...whereCondition,
      ...buildTicketFilters({ status })
    };
  }

  // Matching messages go through a subquery: joining them made the LIMIT
  // count ticket x message rows, so one chat quoting the term many times
  // filled the page and hid the contacts whose name actually matched.
  let searchOrder: any[] = [];

  if (searchParam) {
    const term = `%${searchParam.toLocaleLowerCase().trim()}%`;
    const escapedTerm = Ticket.sequelize.escape(term);

    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        where(fn("LOWER", col("contact.name")), "LIKE", term),
        { "$contact.number$": { [Op.like]: term } },
        {
          id: {
            [Op.in]: literal(
              `(SELECT "ticketId" FROM "Messages" WHERE "companyId" = ${Number(
                companyId
              )} AND LOWER("body") LIKE ${escapedTerm})`
            )
          }
        }
      ]
    };

    // Tickets whose contact name or number matches come first.
    searchOrder = [
      [
        literal(
          `CASE WHEN LOWER("contact"."name") LIKE ${escapedTerm} OR "contact"."number" LIKE ${escapedTerm} THEN 0 ELSE 1 END`
        ),
        "ASC"
      ]
    ];
  }

  if (date) {
    whereCondition = {
      createdAt: {
        [Op.between]: [+startOfDay(parseISO(date)), +endOfDay(parseISO(date))]
      }
    };
  }

  if (updatedAt) {
    whereCondition = {
      updatedAt: {
        [Op.between]: [
          +startOfDay(parseISO(updatedAt)),
          +endOfDay(parseISO(updatedAt))
        ]
      }
    };
  }

  if (withUnreadMessages === "true") {
    const user = await ShowUserService(userId);
    const userQueueIds = user.queues.map(queue => queue.id);

    whereCondition = {
      [Op.or]: [{ userId }, { status: "pending" }],
      queueId: { [Op.or]: [userQueueIds, null] },
      unreadMessages: { [Op.gt]: 0 }
    };
  }

  if (Array.isArray(tags) && tags.length > 0) {
    const ticketsTagFilter: any[] | null = [];
    for (let tag of tags) {
      const ticketTags = await TicketTag.findAll({
        where: { tagId: tag }
      });
      if (ticketTags) {
        ticketsTagFilter.push(ticketTags.map(t => t.ticketId));
      }
    }

    const ticketsIntersection: number[] = intersection(...ticketsTagFilter);

    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: ticketsIntersection
      }
    };
  }

  if (!!onlyFromMe && onlyFromMe != "NAO") {
    users.push(Number(onlyFromMe))
  }

  if (Array.isArray(users) && users.length > 0) {
    const ticketsUserFilter: any[] | null = [];
    for (let user of users) {


      const ticketUsers = await Ticket.findAll({
        where: { userId: user }
      });

      if (ticketUsers) {
        ticketsUserFilter.push(ticketUsers.map(t => t.id));
      }
    }

    const ticketsIntersection: number[] = intersection(...ticketsUserFilter);

    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: ticketsIntersection
      }
    };
  }

  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  whereCondition = {
    ...whereCondition,
    ...buildTicketFilters({ isGroup }),
    companyId
  };

  if (situacao) {
    whereCondition = { ...whereCondition, ...buildTicketFilters({ status: situacao }) };
  }

  // Não visualizadas: conversas com mensagem do cliente que ninguém abriu.
  if (unread === "true") {
    whereCondition = { ...whereCondition, unreadMessages: { [Op.gt]: 0 } };
  }

  const { count, rows: tickets } = await Ticket.findAndCountAll({
    where: whereCondition,
    include: includeCondition,
    distinct: true,
    limit,
    offset,
    order: [...searchOrder, ["updatedAt", "DESC"]],
    subQuery: false
  });

  const hasMore = count > offset + tickets.length;

  return {
    tickets,
    count,
    hasMore
  };
};

export default ListTicketsService;