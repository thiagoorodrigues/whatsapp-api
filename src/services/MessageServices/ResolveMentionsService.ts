import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import WhatsappContact from "../../models/WhatsappContact";
import { getMentionedJids, mentionToken } from "../../helpers/mentions";
import { isLidJid } from "../../helpers/GetPhoneJid";
import { logger } from "../../utils/logger";

export interface MentionView {
  /** Digits as they appear in the text after "@". */
  token: string;
  name: string | null;
  /** Phone digits, when known. */
  phone: string | null;
}

type WithMentions = Pick<Message, "dataJson"> & { mentions?: MentionView[]; quotedMsg?: WithMentions | null };

const jidsOf = (message: WithMentions): string[] => {
  if (!message.dataJson) return [];
  try {
    return getMentionedJids(JSON.parse(message.dataJson)?.message);
  } catch (e) {
    return [];
  }
};

// A contact created without a name carries its number (or LID digits) as
// name: that is not a name to show.
const realName = (name: string | null | undefined, ...numbers: (string | null | undefined)[]): string | null =>
  name && !numbers.includes(name) ? name : null;

/**
 * Fills message.mentions with the name of each person mentioned: platform
 * contact, then the names WhatsApp sent (address book, verified, profile),
 * then the connected account itself. Three queries at most for the page.
 */
const ResolveMentionsService = async (page: WithMentions[], companyId: number): Promise<void> => {
  // Quoted messages are shown too (the quote above a reply).
  const messages = page.flatMap(m => (m.quotedMsg ? [m, m.quotedMsg] : [m]));
  const perMessage = messages.map(jidsOf);
  const all = [...new Set(perMessage.flat())];

  const lids = all.filter(isLidJid);
  const phones = all.filter(jid => !isLidJid(jid)).map(mentionToken);
  const tokens = all.map(mentionToken);

  let contacts: Contact[] = [];
  let synced: WhatsappContact[] = [];
  let connections: Whatsapp[] = [];

  if (all.length) {
    try {
      [contacts, synced, connections] = await Promise.all([
        Contact.findAll({
          where: { companyId, [Op.or]: [{ number: { [Op.in]: tokens } }, { lid: { [Op.in]: lids } }] },
          attributes: ["name", "number", "lid"]
        }),
        WhatsappContact.findAll({
          where: { companyId, [Op.or]: [{ jid: { [Op.in]: all } }, { lid: { [Op.in]: lids } }, { number: { [Op.in]: phones } }] },
          attributes: ["jid", "lid", "number", "name", "verifiedName", "notify"]
        }),
        phones.length
          ? Whatsapp.findAll({ where: { companyId, number: { [Op.in]: phones } }, attributes: ["name", "number"] })
          : Promise.resolve([] as Whatsapp[])
      ]);
    } catch (err) {
      logger.warn(`Could not resolve mention names: ${err}`);
    }
  }

  const resolve = (jid: string): MentionView => {
    const token = mentionToken(jid);
    const lid = isLidJid(jid) ? jid : null;

    const contact =
      contacts.find(c => lid && c.lid === lid) ||
      contacts.find(c => c.number === token);
    // WhatsApp may keep one row per address (LID row with only the profile
    // name, phone row with the address book name): take each field from
    // the first row that has it.
    const rows = synced.filter(
      s => s.jid === jid || (lid && s.lid === lid) || (!lid && s.number === token)
    );
    const field = (key: "name" | "verifiedName" | "notify" | "number"): string | null =>
      rows.map(row => row[key]).find(Boolean) || null;

    const phone =
      (!lid ? token : null) ||
      (contact && contact.number !== token ? contact.number : null) ||
      field("number");
    const own = phone ? connections.find(w => w.number === phone) : undefined;

    const name =
      realName(contact?.name, contact?.number, token) ||
      field("name") ||
      field("verifiedName") ||
      field("notify") ||
      own?.name ||
      null;

    return { token, name, phone };
  };

  messages.forEach((message, i) => {
    message.mentions = perMessage[i].map(resolve);
  });
};

export default ResolveMentionsService;
