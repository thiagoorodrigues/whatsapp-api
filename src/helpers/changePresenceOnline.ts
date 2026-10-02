import { logger } from "../utils/logger";
import { getChannel } from "../channels";
import Whatsapp from "../models/Whatsapp";

// Enquanto o número aparece online no WeConex o WhatsApp não notifica o
// celular. Só fica online a conexão que pediu e enquanto há alguém logado.
export const ApplyPresence = async (whatsapp: Whatsapp, logout?: boolean): Promise<void> => {
    if (whatsapp.status !== "CONNECTED") return;
    try {
        await getChannel(whatsapp.id).setPresence(
            !logout && whatsapp.showOnline ? "available" : "unavailable"
        );
    } catch (err) {
        logger.info(`Presence of connection ${whatsapp.id}: ${err}`);
    }
};

const ChangePresenceOnline = async (companyId: number, logout?: boolean): Promise<void> => {
    const whatsapps = await Whatsapp.findAll({ where: { companyId, status: "CONNECTED" } });
    await Promise.all(whatsapps.map(whatsapp => ApplyPresence(whatsapp, logout)));
};

export default ChangePresenceOnline;
