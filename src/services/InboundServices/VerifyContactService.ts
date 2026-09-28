import { getChannel } from "../../channels";
import { isLidJid, toUserLid } from "../../helpers/GetPhoneJid";
import Contact from "../../models/Contact";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";

interface Request {
  /** Phone JID, LID (members known only by it) or group JID. */
  jid: string;
  name?: string;
  lid?: string;
  connectionId: number;
  companyId: number;
}

/** Creates or updates the contact (or group) a message came from. */
const VerifyContactService = async ({ jid, name, lid, connectionId, companyId }: Request): Promise<Contact> => {
  let profilePicUrl: string | null = null;
  try {
    profilePicUrl = await getChannel(connectionId).profilePictureUrl({ jid });
  } catch (e) {
    // connection going down: keep the contact without a new picture
  }

  return CreateOrUpdateContactService({
    name: name || jid.replace(/\D/g, ""),
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
