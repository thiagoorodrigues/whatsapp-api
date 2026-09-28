import { promises as fs } from "fs";
import { Op } from "sequelize";
import { SentMessage } from "../../channels";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import SaveSentMessageService from "../MessageServices/SaveSentMessageService";

interface Request {
  companyId: number;
  /** Connection the campaign was sent through. */
  whatsappId: number;
  number: string;
  /** Name in the contact list, for a contact created now. */
  name: string;
  sent: SentMessage;
  body: string;
  media?: { path: string; fileName: string; mimetype: string };
}

/** Shippings prepared before this change start with the old U+200C marker. */
export const campaignText = (stored?: string | null): string =>
  `${stored || ""}`.replace(/^\u200c ?/, "");

/**
 * Puts a sent campaign message in the contact's history. A ticket being
 * attended (open or pending) gets it and keeps its status; otherwise it
 * goes to the contact's latest ticket, or a new one, left closed, so a
 * campaign never opens or closes an attendance.
 */
const SaveCampaignMessageService = async ({
  companyId,
  whatsappId,
  number,
  name,
  sent,
  body,
  media
}: Request): Promise<Message> => {
  const contact = await CreateOrUpdateContactService({ name, number, isGroup: false, companyId, whatsappId });

  const where = { contactId: contact.id, companyId, whatsappId };
  const ticket =
    (await Ticket.findOne({ where: { ...where, status: { [Op.in]: ["open", "pending"] } }, order: [["id", "DESC"]] })) ||
    (await Ticket.findOne({ where, order: [["id", "DESC"]] })) ||
    (await Ticket.create({ ...where, status: "closed", isGroup: false, unreadMessages: 0 }));

  const file = media
    ? { buffer: await fs.readFile(media.path), fileName: media.fileName, mimetype: media.mimetype }
    : undefined;

  return SaveSentMessageService({ ticket, sent, body, ...(file ? { media: file } : {}) });
};

export default SaveCampaignMessageService;
