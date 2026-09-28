import { Op } from "sequelize";
import WhatsappContact from "../../models/WhatsappContact";
import { isLidJid, toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";

/** Contact as WhatsApp sends it (same shape as Baileys' Contact). */
export interface SyncedContact {
  id: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

interface Request {
  whatsappId: number;
  companyId: number;
  contacts: SyncedContact[];
}

type Fields = Pick<WhatsappContact, "lid" | "number" | "name" | "notify" | "verifiedName">;

const FIELDS: (keyof Fields)[] = ["lid", "number", "name", "notify", "verifiedName"];
const CHUNK = 500;

const isPersonJid = (jid?: string): boolean =>
  !!jid && (jid.endsWith("@s.whatsapp.net") || isLidJid(jid));

const fieldsOf = (c: SyncedContact): Fields => {
  const lid = isLidJid(c.id) ? toUserLid(c.id) : toUserLid(c.lid);
  const phone = isLidJid(c.id) ? c.phoneNumber : c.id;
  return {
    lid: lid || null,
    number: toPhoneNumber(phone) || null,
    name: c.name || null,
    notify: c.notify || null,
    verifiedName: c.verifiedName || null
  };
};

// A later event may carry only some fields (e.g. contacts.update with just
// the profile name): empty values never erase what is already saved.
const merge = (saved: Fields, incoming: Fields): Fields =>
  FIELDS.reduce((acc, key) => ({ ...acc, [key]: incoming[key] || saved[key] || null }), {} as Fields);

const UpsertWhatsappContactsService = async ({ whatsappId, companyId, contacts }: Request): Promise<number> => {
  const byJid = new Map<string, Fields>();
  contacts
    .filter(c => isPersonJid(c?.id))
    .forEach(c => {
      const jid = c.id.replace(/:\d+@/, "@");
      const previous = byJid.get(jid);
      const fields = fieldsOf(c);
      byJid.set(jid, previous ? merge(previous, fields) : fields);
    });

  const jids = [...byJid.keys()];
  let written = 0;

  for (let i = 0; i < jids.length; i += CHUNK) {
    const chunk = jids.slice(i, i + CHUNK);
    const existing = await WhatsappContact.findAll({ where: { whatsappId, jid: { [Op.in]: chunk } } });
    const existingByJid = new Map(existing.map(row => [row.jid, row]));

    const toCreate = [];
    for (const jid of chunk) {
      const incoming = byJid.get(jid) as Fields;
      const row = existingByJid.get(jid);
      if (!row) {
        toCreate.push({ whatsappId, companyId, jid, ...incoming });
        continue;
      }
      const merged = merge(row, incoming);
      if (FIELDS.some(key => (row[key] || null) !== merged[key])) {
        await row.update(merged);
        written += 1;
      }
    }

    if (toCreate.length) {
      await WhatsappContact.bulkCreate(toCreate, { ignoreDuplicates: true });
      written += toCreate.length;
    }
  }

  return written;
};

export default UpsertWhatsappContactsService;
