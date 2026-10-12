import { Op } from "sequelize";
import Contact from "../models/Contact";
import Message from "../models/Message";

// Maps a LID seen before back to the phone JID: first the contact that
// stored it, then an earlier incoming message from that LID.
export const lookupPhoneJidByLid = async (lid: string, companyId?: number): Promise<string | undefined> => {
  const byContact = await Contact.findOne({
    where: companyId ? { lid, companyId } : { lid },
    attributes: ["number"]
  });
  if (byContact?.number) return `${byContact.number}@s.whatsapp.net`;

  const earlier = await Message.findOne({
    where: {
      remoteJid: lid,
      fromMe: false,
      contactId: { [Op.ne]: null },
      ...(companyId ? { companyId } : {})
    },
    include: [{ model: Contact, as: "contact", attributes: ["number"] }],
    order: [["createdAt", "DESC"]]
  });
  const number = (earlier as any)?.contact?.number;
  return number ? `${number}@s.whatsapp.net` : undefined;
};
