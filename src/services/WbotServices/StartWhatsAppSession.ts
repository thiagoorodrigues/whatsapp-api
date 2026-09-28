import { initWASocket } from "../../libs/wbot";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";
import SyncSessionContactsService from "../WhatsappContactServices/SyncSessionContactsService";

// LID <-> phone pairs the session already learned (saved by authState).
const sessionLidMapping = (session?: string | null): Record<string, unknown> | undefined => {
  if (!session) return undefined;
  try {
    return JSON.parse(session)?.keys?.lidMapping;
  } catch (e) {
    return undefined;
  }
};

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
      await whatsapp.reload();
      await SyncSessionContactsService({
        whatsappId: whatsapp.id,
        companyId,
        me: wbot.user,
        lidMapping: sessionLidMapping(whatsapp.session)
      });
    } catch (err) {
      logger.warn(`Could not sync session contacts: ${err}`);
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};
