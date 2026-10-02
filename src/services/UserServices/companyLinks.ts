import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";

export const PROFILES = ["admin", "user"];

// Queues and default connection of a user must belong to the user's company;
// ids of other companies sent in the body are dropped.
export const scopeUserLinks = async (
  companyId: number,
  queueIds: number[] = [],
  whatsappId?: number | null
): Promise<{ queueIds: number[]; whatsappId: number | null }> => {
  const ids = (Array.isArray(queueIds) ? queueIds : []).map(Number).filter(Boolean);
  const queues = ids.length
    ? await Queue.findAll({ where: { id: ids, companyId }, attributes: ["id"] })
    : [];
  const whatsapp = whatsappId
    ? await Whatsapp.findOne({ where: { id: whatsappId, companyId }, attributes: ["id"] })
    : null;
  return { queueIds: queues.map(q => q.id), whatsappId: whatsapp ? whatsapp.id : null };
};
