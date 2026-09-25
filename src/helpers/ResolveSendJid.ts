import Contact from "../models/Contact";
import { getContactJid } from "./GetPhoneJid";

/**
 * Send address for callers that only know a phone number (external API,
 * campaigns): use the stored contact's LID when we have one, see
 * getContactJid for why that matters.
 */
const ResolveSendJid = async (
  number: string | number,
  companyId: number
): Promise<string> => {
  const digits = `${number}`.replace(/\D/g, "");
  const contact = await Contact.findOne({
    where: { number: digits, companyId },
    attributes: ["number", "lid"]
  });
  return getContactJid(contact || { number: digits });
};

export default ResolveSendJid;
