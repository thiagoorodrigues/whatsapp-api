import * as Yup from "yup";

import AppError from "../../errors/AppError";
import Schedule from "../../models/Schedule";
import ShowService from "./ShowService";

interface Request {
  body: string;
  sendAt: string;
  contactId: number | string;
  companyId: number | string;
  userId?: number | string;
  whatsappsId: number | string;
}

const CreateService = async ({
  body,
  sendAt,
  contactId,
  companyId,
  userId,
  whatsappsId
}: Request): Promise<Schedule> => {
  const schema = Yup.object().shape({
    body: Yup.string().required().min(5),
    sendAt: Yup.string().required(),
    whatsappsId: Yup.mixed().required("Conexão é obrigatório!")
  });

  try {
    await schema.validate({ body, sendAt, whatsappsId });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const schedule = await Schedule.create(
    {
      body,
      sendAt,
      contactId,
      companyId,
      userId,
      whatsappsId,
      status: 'PENDENTE'
    }
  );

  // With contact and user: the agenda page shows schedule.contact.name from
  // the socket event.
  return ShowService(schedule.id, Number(companyId));
};

export default CreateService;
