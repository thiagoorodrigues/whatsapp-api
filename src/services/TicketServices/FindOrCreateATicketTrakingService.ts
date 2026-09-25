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
      startedAt
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

  const newRecord = await TicketTraking.create({
    ticketId,
    companyId,
    whatsappId,
    userId
  });

  return newRecord;
};

export default FindOrCreateATicketTrakingService;
