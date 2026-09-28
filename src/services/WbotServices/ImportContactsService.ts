import * as Sentry from "@sentry/node";
import { Op } from "sequelize";
import { getDefaultChannel } from "../../channels";
import Contact from "../../models/Contact";
import WhatsappContact from "../../models/WhatsappContact";
import { logger } from "../../utils/logger";
import CreateContactService from "../ContactServices/CreateContactService";

// "Importar contatos": turns the phone contacts WhatsApp sent to the default
// connection (WhatsappContacts) into platform contacts. Names typed in the
// platform are kept; only contacts still named after their number are
// renamed.
const ImportContactsService = async (companyId: number): Promise<void> => {
  const channel = await getDefaultChannel(companyId);

  const synced = await WhatsappContact.findAll({
    where: { whatsappId: channel.connectionId, number: { [Op.ne]: null } }
  });

  for (const item of synced) {
    const number = `${item.number}`;
    const name = item.name || item.verifiedName || item.notify || number;

    try {
      const existing = await Contact.findOne({ where: { number, companyId } });
      if (existing) {
        if ((!existing.name || existing.name === existing.number) && name !== number) {
          existing.name = name;
          await existing.save();
        }
      } else {
        await CreateContactService({ number, name, companyId });
      }
    } catch (error) {
      Sentry.captureException(error);
      logger.warn(`Could not import WhatsApp contact ${number}: ${error}`);
    }
  }
};

export default ImportContactsService;
