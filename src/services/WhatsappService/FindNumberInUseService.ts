import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";

/**
 * Another connection of the company that has this number connected. The same
 * number on two connections shows every conversation twice (and doubles
 * reports), so a new pairing of a number already in use is refused.
 * Different companies may share a number.
 */
const FindNumberInUseService = async (
  whatsapp: Pick<Whatsapp, "id" | "companyId">,
  number: string,
  isLive: (whatsappId: number) => boolean
): Promise<Whatsapp | null> => {
  if (!number) return null;
  const twins = await Whatsapp.findAll({
    where: { companyId: whatsapp.companyId, number, status: "CONNECTED", id: { [Op.ne]: whatsapp.id } },
    attributes: ["id", "name"]
  });
  // Status left as CONNECTED by a connection that is not running does not count.
  return twins.find(twin => isLive(twin.id)) || null;
};

export default FindNumberInUseService;
