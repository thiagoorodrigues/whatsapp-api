import { Op } from "sequelize";
import TicketTraking from "../../models/TicketTraking";

interface Params {
  ticketId: string | number;
  companyId: string | number;
  whatsappId?: string | number;
  userId?: string | number;
  oldUserId?: string;
  startedAt?: Date;
}

const FindOrCreateATicketTrakingService = async ({
  ticketId,
  companyId,
  whatsappId,
  userId,
  oldUserId,
  startedAt
}: Params): Promise<TicketTraking> => {

  if(!!oldUserId){
    const newRecord = await TicketTraking.create({
      ticketId,
      companyId,
      whatsappId,
      userId,
      oldUserId,
      startedAt,
      queuedAt: startedAt || new Date()
    });
  
    return newRecord;
  }

  let where: any = {
    ticketId,
    finishedAt: {
      [Op.is]: null
    }
  }
  
  if (!!userId)
    where.userId = userId

  const ticketTraking = await TicketTraking.findOne({
    where: where
  });

  if (ticketTraking) {
    return ticketTraking;
  }

  // A new tracking row = a new attendance entering the system now. Reports
  // filter periods by this date, so it must never be left empty.
  const newRecord = await TicketTraking.create({
    ticketId,
    companyId,
    whatsappId,
    userId,
    startedAt,
    queuedAt: startedAt || new Date()
  });

  return newRecord;
};

export default FindOrCreateATicketTrakingService;
