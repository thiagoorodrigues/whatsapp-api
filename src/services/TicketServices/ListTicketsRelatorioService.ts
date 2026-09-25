import { Op, Filterable, Includeable } from "sequelize";
import { startOfDay, endOfDay, parseISO } from "date-fns";
import { intersection } from "lodash";

import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import User from "../../models/User";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";

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
  userId: string;
  companyId: number;
  pageNumber: string;
  order?: [string, 'ASC' | 'DESC'][];
}

interface Response {
  tickets: Ticket[];
  count: number;
  hasMore: boolean;
}

const ListTicketsRelatorioService = async ({
  pageNumber = "1",
  userId,
  companyId,
  ticket,
  tipoData,
  dataInicial,
  dataFinal,
  connections,
  cliente,
  usuario,
  queues,
  status,
  order = [["updatedAt", "DESC"]]
}: Request): Promise<Response> => {

  let whereCondition: Filterable["where"] = {
    [Op.or]: [{ userId }, { status: "pending" }]
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
      attributes: ["name"]
    },
  ];

  //whereCondition = { queueId: { [Op.or]: [queueIds, null] } };

  whereCondition = {
    ...whereCondition,
    companyId
  };

  if(!!ticket){
    whereCondition = {
      ...whereCondition, 
      id: ticket
    }
  }

  if (dataInicial || dataFinal) {
    const campoData = tipoData === 'DataAbertura' ? 'createdAt' : 'updatedAt';
  
    if (dataInicial && dataFinal) {
      whereCondition = {
        ...whereCondition,
        [campoData]: {
          [Op.between]: [+startOfDay(parseISO(dataInicial)), +endOfDay(parseISO(dataFinal))]
        }
      };
    } else if (dataInicial) {
      whereCondition = {
        ...whereCondition,
        [campoData]: {
          [Op.gte]: +startOfDay(parseISO(dataInicial))
        }
      };
    } else if (dataFinal) {
      whereCondition = {
        ...whereCondition,
        [campoData]: {
          [Op.lte]: +endOfDay(parseISO(dataFinal))
        }
      };
    }
  }

  if (Array.isArray(connections) && connections.length > 0) {
    whereCondition = {
      ...whereCondition,
      whatsappId: {
        [Op.in]: intersection(connections)
      }
    };
  }

  if (Array.isArray(queues) && queues.length > 0) {
    whereCondition = {
      ...whereCondition,
      queueId: {
        [Op.in]: intersection(queues)
      }
    };
  }

  if(!!status){
    whereCondition = {
      ...whereCondition, 
      status: status
    }
  }

  if (!!cliente) {
    const contacts = await Contact.findAll({
      where: {
        name: {
          [Op.iLike]: `%${cliente}%`
        }
      }
    });

    const contactIds = contacts.map(contact => contact.id);
    whereCondition = {
      ...whereCondition,
      contactId: {
        [Op.in]: contactIds || []
      }
    };
  }

  if (usuario) {
    const users = await User.findAll({
      where: {
        name: {
          [Op.iLike]: `%${usuario}%`
        }
      }
    });

    const userIds = users.map(user => user.id);
    whereCondition = {
      ...whereCondition,
      userId: {
        [Op.in]: userIds || []
      }
    };
  }

  const limit = 40;
  const offset = limit * (+pageNumber - 1);
  const { count, rows: tickets } = await Ticket.findAndCountAll({
    where: whereCondition,
    include: includeCondition,
    distinct: true,
    limit,
    offset,
    order,
    subQuery: false
  });

  const hasMore = count > offset + tickets.length;

  return {
    tickets,
    count,
    hasMore
  };
};

export default ListTicketsRelatorioService;