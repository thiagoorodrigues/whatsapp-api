import { initWASocket } from "../../libs/wbot";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";
import SyncSessionContactsService from "../WhatsappContactServices/SyncSessionContactsService";
import { readKeysOfType } from "../../models/BaileysKey";

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  io.emit(`company-${companyId}-whatsappSession`, {
    action: "update",
    session: whatsapp
  });

  try {
    const wbot = await initWASocket(whatsapp);
    wbotMessageListener(wbot, companyId);
    wbotMonitor(wbot, whatsapp, companyId);

    try {
      await SyncSessionContactsService({
        whatsappId: whatsapp.id,
        companyId,
        me: wbot.user,
        // LID <-> phone pairs the session already learned (saved by the key store).
        lidMapping: await readKeysOfType(whatsapp.id, "lid-mapping")
      });
    } catch (err) {
      logger.warn(`Could not sync session contacts: ${err}`);
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};
