import { logger } from "../utils/logger";
import CheckSettings from "./CheckSettings";
import { getDefaultChannel } from "../channels";

const ChangePresenceOnline = async (companyId: number, logout?: boolean): Promise<void> => {
    try {
        const exibeStatusOnline = await CheckSettings("ExibeStatusOnline");
        const channel = await getDefaultChannel(companyId);

        if (!!logout || exibeStatusOnline == "0") {
            await channel.setPresence("unavailable");
        } else if (exibeStatusOnline == "1") {
            await channel.setPresence("available");
        }
    } catch (err) {
        logger.info(err);
    }
};

export default ChangePresenceOnline;
