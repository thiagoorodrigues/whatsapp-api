import * as Yup from "yup";
import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import ShowWhatsAppService from "./ShowWhatsAppService";
import AssociateWhatsappQueue from "./AssociateWhatsappQueue";
import { logger } from "../../utils/logger";

interface WhatsappData {
  name?: string;
  status?: string;
  session?: string;
  isDefault?: boolean;
  greetingMessage?: string;
  complationMessage?: string;
  outOfHoursMessage?: string;
  ratingMessage?: string;
  queueIds?: number[];
  token?: string;
  //sendIdQueue?: number;
  //timeSendQueue?: number;
  transferQueueId?: number;
  timeToTransfer?: number;
  promptId?: number;
  maxUseBotQueues?: number;
  timeUseBotQueues?: number;
  expiresTicket?: number;
  expiresInactiveMessage?: string;
  importMessages?: boolean;
  initialDate?: string;
  finalDate?: string;
}

interface Request {
  whatsappData: WhatsappData;
  whatsappId: string;
  companyId: number;
}

interface Response {
  whatsapp: Whatsapp;
  oldDefaultWhatsapp: Whatsapp | null;
}

const UpdateWhatsAppService = async ({ whatsappData, whatsappId, companyId }: Request): Promise<Response> => {

  const schema = Yup.object().shape({
    name: Yup.string().min(2),
    status: Yup.string(),
    isDefault: Yup.boolean()
  });

  // logger.info(whatsappData);

  const {
    name,
    status,
    isDefault,
    session,
    greetingMessage,
    complationMessage,
    outOfHoursMessage,
    ratingMessage,
    queueIds = [],
    token,
    importMessages = false,
    initialDate = null,
    finalDate = null,
    //timeSendQueue,
    //sendIdQueue = null,
    transferQueueId,
    timeToTransfer,
    promptId,
    maxUseBotQueues,
    timeUseBotQueues,
    expiresTicket,
    expiresInactiveMessage
  } = whatsappData;

  try {
    await schema.validate({ name, status, isDefault });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  if (queueIds.length > 1 && !greetingMessage) {
    throw new AppError("ERR_WAPP_GREETING_REQUIRED");
  }

  let oldDefaultWhatsapp: Whatsapp | null = null;

  if (isDefault) {
    oldDefaultWhatsapp = await Whatsapp.findOne({
      where: {
        isDefault: true,
        id: { [Op.not]: whatsappId },
        companyId
      }
    });
    if (oldDefaultWhatsapp) {
      await oldDefaultWhatsapp.update({ isDefault: false });
    }
  }

  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

  // logger.info({
  //   name,
  //   status,
  //   session,
  //   greetingMessage,
  //   complationMessage,
  //   outOfHoursMessage,
  //   ratingMessage,
  //   isDefault,
  //   companyId,
  //   token,
  //   importMessages,
  //   initialDate,
  //   finalDate,
  //   //timeSendQueue,
  //   //sendIdQueue,
  //   transferQueueId,
  //   timeToTransfer,
  //   promptId,
  //   maxUseBotQueues,
  //   timeUseBotQueues,
  //   expiresTicket,
  //   expiresInactiveMessage
  // });

  await whatsapp.update({
    name,
    status,
    session,
    greetingMessage,
    complationMessage,
    outOfHoursMessage,
    ratingMessage,
    isDefault,
    companyId,
    token,
    importMessages,
    initialDate,
    finalDate,
    //timeSendQueue,
    //sendIdQueue,
    transferQueueId,
    timeToTransfer,
    promptId,
    maxUseBotQueues,
    timeUseBotQueues,
    expiresTicket,
    expiresInactiveMessage
  });

  await AssociateWhatsappQueue(whatsapp, queueIds);

  return { whatsapp, oldDefaultWhatsapp };
};

export default UpdateWhatsAppService;
