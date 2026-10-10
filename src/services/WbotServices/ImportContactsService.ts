import * as Sentry from "@sentry/node";
import { getDefaultChannel } from "../../channels";
import Contact from "../../models/Contact";
import WhatsappContact from "../../models/WhatsappContact";
import { logger } from "../../utils/logger";
import CreateContactService from "../ContactServices/CreateContactService";

// "Importar contatos": turns the phone contacts WhatsApp sent to the default
// connection (WhatsappContacts) into platform contacts. Names typed in the
// platform are kept; only contacts still named after their number are
// renamed.
const filled = (v?: string | null): string | undefined => (v && v.trim() ? v.trim() : undefined);
const nameOf = (item: WhatsappContact): string | undefined =>
  filled(item.name) || filled(item.verifiedName) || filled(item.notify);

const ImportContactsService = async (companyId: number): Promise<void> => {
  const channel = await getDefaultChannel(companyId);

  const synced = await WhatsappContact.findAll({ where: { whatsappId: channel.connectionId } });

  // WhatsApp often sends the same person twice: one entry by phone (often
  // without a name) and one by LID (with the name). Names by LID, to fill in.
  const nameByLid = new Map<string, string>();
  for (const item of synced) {
    const name = nameOf(item);
    if (!name) continue;
    [item.lid, item.jid?.endsWith("@lid") ? item.jid : null].forEach(lid => {
      if (lid && !nameByLid.has(lid)) nameByLid.set(lid, name);
    });
  }

  // Only entries with a phone number become contacts; LID-only ones would
  // duplicate once the number shows up, and come in with their first message.
  for (const item of synced.filter(entry => entry.number)) {
    const number = `${item.number}`;
    const name = nameOf(item) || (item.lid ? nameByLid.get(item.lid) : undefined) || number;

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
