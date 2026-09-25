import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import GetWhatsappWbot from "../../helpers/GetWhatsappWbot";
import ChangePresenceOnline from "../../helpers/changePresenceOnline";
import Setting from "../../models/Setting";
import { logger } from "../../utils/logger";

interface Request {
  key: string;
  value: string;
  companyId: number;
}

const UpdateSettingService = async ({
  key,
  value,
  companyId
}: Request): Promise<Setting | undefined> => {
  const [setting] = await Setting.findOrCreate({
    where: {
      key,
      companyId
    },
    defaults: {
      key,
      value,
      companyId
    }
  });

  if (setting != null && setting?.companyId !== companyId) {
    throw new AppError("Não é possível consultar registros de outra empresa");
  }

  if (!setting) {
    throw new AppError("ERR_NO_SETTING_FOUND", 404);
  }

  await setting.update({ value });

  if (key == "ExibeStatusOnline") {
    //Setar a presença de acordo com configuração do cliente
    await ChangePresenceOnline(companyId);
  }

  return setting;
};

export default UpdateSettingService;
