import Contact from "../../models/Contact";
import { toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";
import { logger } from "../../utils/logger";
import UpsertWhatsappContactsService from "./UpsertWhatsappContactsService";

interface Request {
  whatsappId: number;
  companyId: number;
  /** JID completo do LID (aceita sufixo de dispositivo). */
  lid: string;
  /** JID completo do telefone. */
  pn: string;
}

// Par telefone <-> LID descoberto pelo WhatsApp: guarda o LID no contato (envios
// vão para o LID e mensagens só com LID caem no mesmo contato) e na lista de
// contatos da conexão. Comum aos dois motores (Baileys e gateway).
const ApplyLidMappingService = async ({ whatsappId, companyId, lid, pn }: Request): Promise<void> => {
  try {
    const number = toPhoneNumber(pn);
    const userLid = toUserLid(lid);
    if (!userLid || !number) return;
    await Contact.update({ lid: userLid }, { where: { number, companyId } });
    await UpsertWhatsappContactsService({
      whatsappId,
      companyId,
      contacts: [{ id: `${number}@s.whatsapp.net`, lid: userLid }]
    });
  } catch (err) {
    logger.warn(`lid-mapping.update failed for ${lid}: ${err}`);
  }
};

export default ApplyLidMappingService;
