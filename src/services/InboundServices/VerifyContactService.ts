import { getChannel } from "../../channels";
import { isLidJid, toUserLid } from "../../helpers/GetPhoneJid";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import WhatsappContact from "../../models/WhatsappContact";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";

interface Request {
  /** Phone JID, LID (members known only by it) or group JID. */
  jid: string;
  name?: string;
  lid?: string;
  connectionId: number;
  companyId: number;
}

const filled = (v?: string | null): string | undefined => (v && v.trim() ? v.trim() : undefined);

// History messages usually come without the sender's name. The address book
// synced from the phone has it: saved name, then verified business name, then
// the name the person uses on WhatsApp.
const addressBookName = async (connectionId: number, companyId: number, jid: string, lid?: string): Promise<string | undefined> => {
  const ids = [jid, lid].filter(Boolean) as string[];
  const entry = await WhatsappContact.findOne({
    where: { whatsappId: connectionId, companyId, [Op.or]: [{ jid: { [Op.in]: ids } }, { lid: { [Op.in]: ids } }] }
  });
  return filled(entry?.name) || filled(entry?.verifiedName) || filled(entry?.notify);
};

/** Creates or updates the contact (or group) a message came from. */
const VerifyContactService = async ({ jid, name, lid, connectionId, companyId }: Request): Promise<Contact> => {
  let profilePicUrl: string | null = null;
  try {
    profilePicUrl = await getChannel(connectionId).profilePictureUrl({ jid });
  } catch (e) {
    // connection going down: keep the contact without a new picture
  }

  const number = jid.replace(/\D/g, "");
  const isGroup = jid.includes("g.us");
  let finalName = filled(name) !== number ? filled(name) : undefined;
  if (!finalName && !isGroup) {
    finalName = await addressBookName(connectionId, companyId, jid, lid).catch((): undefined => undefined);
  }

  return CreateOrUpdateContactService({
    name: finalName || number,
    number: jid.replace(/\D/g, ""),
    profilePicUrl: profilePicUrl || `${process.env.FRONTEND_URL}/nopicture.png`,
    isGroup: jid.includes("g.us"),
    companyId,
    whatsappId: connectionId,
    // A LID is remembered once tied to a phone number; a group member known
    // only by LID keeps it as its address.
    lid: isLidJid(jid) ? toUserLid(jid) : lid || undefined
  });
};

export default VerifyContactService;
