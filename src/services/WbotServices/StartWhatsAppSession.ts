import { initWASocket } from "../../libs/wbot";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";
import SyncSessionContactsService from "../WhatsappContactServices/SyncSessionContactsService";
import { readKeysOfType } from "../../models/BaileysKey";
import { companyRoom } from "../../libs/socketRooms";
import { isWhatsmeow } from "../../config/whatsappEngine";
import SessionService from "../WhatsmeowServices/SessionService";

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  // Motor whatsmeow: a sessão vive no gateway (POST /connect); nada de socket Baileys.
  if (isWhatsmeow()) {
    await SessionService.start(whatsapp);
    return;
  }

  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-whatsappSession`, {
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
