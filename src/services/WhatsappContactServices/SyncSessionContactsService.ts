import { Op } from "sequelize";
import Contact from "../../models/Contact";
import { toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";
import UpsertWhatsappContactsService, { SyncedContact } from "./UpsertWhatsappContactsService";

interface Request {
  whatsappId: number;
  companyId: number;
  /** The connected account (wbot.user). */
  me?: { id?: string; lid?: string; name?: string };
  /**
   * Session "lid-mapping" keys: { "<phone digits>": "<lid digits>",
   * "<lid digits>_reverse": "<phone digits>" }.
   */
  lidMapping?: Record<string, unknown>;
}

/**
 * On connect, records what the session already knows and WhatsApp does not
 * send again: the connected account itself and the LID <-> phone pairs
 * learned so far. Mentions by LID can then reach the phone, and the phone
 * the platform contact.
 */
const SyncSessionContactsService = async ({ whatsappId, companyId, me, lidMapping }: Request): Promise<void> => {
  const contacts: SyncedContact[] = [];

  const myNumber = toPhoneNumber(me?.id);
  if (myNumber) {
    contacts.push({
      id: `${myNumber}@s.whatsapp.net`,
      ...(toUserLid(me?.lid) ? { lid: toUserLid(me?.lid) } : {}),
      ...(me?.name ? { notify: me.name } : {})
    });
  }

  const pairs = Object.entries(lidMapping || {})
    .filter(([key, value]) => !key.endsWith("_reverse") && /^\d+$/.test(key) && typeof value === "string" && /^\d+$/.test(value))
    .map(([number, lid]) => ({ number, lid: `${lid}@lid` }));
  pairs.forEach(({ number, lid }) => contacts.push({ id: `${number}@s.whatsapp.net`, lid }));

  if (!contacts.length) return;

  await UpsertWhatsappContactsService({ whatsappId, companyId, contacts });

  if (!pairs.length) return;
  const lidByNumber = new Map(pairs.map(p => [p.number, p.lid]));
  const withoutLid = await Contact.findAll({
    where: { companyId, number: { [Op.in]: [...lidByNumber.keys()] }, lid: null }
  });
  for (const contact of withoutLid) {
    await contact.update({ lid: lidByNumber.get(contact.number) });
  }
};

export default SyncSessionContactsService;
