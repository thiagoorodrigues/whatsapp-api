import { logger } from "../utils/logger";
import CheckSettings from "./CheckSettings";
import GetDefaultWhatsApp from "./GetDefaultWhatsApp";
import GetWhatsappWbot from "./GetWhatsappWbot";

const ChangePresenceOnline = async (companyId: number, logout?: boolean): Promise<void> => {
    try {
        const exibeStatusOnline = await CheckSettings("ExibeStatusOnline");

        const defaultWhats = await GetDefaultWhatsApp(companyId);
        const wbot = await GetWhatsappWbot(defaultWhats);
        const session = JSON.parse(defaultWhats.session);

        if (!!logout) {
            wbot.sendPresenceUpdate("unavailable", session.creds.me.id);
            return
        }

        if (session.creds.me.id && exibeStatusOnline == "0") {
            wbot.sendPresenceUpdate("unavailable", session.creds.me.id);
        } else if (session.creds.me.id && exibeStatusOnline == "1") {
            wbot.sendPresenceUpdate("available", session.creds.me.id);
        }
    } catch (err) {
        logger.info(err);
    }
};

export default ChangePresenceOnline;
