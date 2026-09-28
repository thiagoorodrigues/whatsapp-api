import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import GetDefaultWhatsApp from "../helpers/GetDefaultWhatsApp";
import GetDefaultWhatsAppByUser from "../helpers/GetDefaultWhatsAppByUser";
import BaileysChannel from "./baileys/BaileysChannel";
import { ChatAddress, MessageRef, MessagingChannel } from "./types";

export * from "./types";

/**
 * Channel of a connection. Throws ERR_WAPP_NOT_INITIALIZED when the
 * connection has no live session.
 */
export const getChannel = (connectionId: number): MessagingChannel => new BaileysChannel(connectionId);

/** Channel of a ticket; a ticket without connection takes its user's default. */
export const getTicketChannel = async (ticket: Ticket): Promise<MessagingChannel> => {
  if (!ticket.whatsappId) {
    const defaultWhatsapp = await GetDefaultWhatsAppByUser(ticket.user.id);
    await ticket.$set("whatsapp", defaultWhatsapp);
  }
  return getChannel(ticket.whatsappId);
};

/** Channel of the company's default connected connection. */
export const getDefaultChannel = async (companyId: number): Promise<MessagingChannel> =>
  getChannel((await GetDefaultWhatsApp(companyId)).id);

export const contactAddress = (
  contact: Pick<Contact, "number"> & { lid?: string | null },
  isGroup = false
): ChatAddress => ({ number: contact.number, lid: contact.lid, isGroup });

export const ticketAddress = (ticket: Ticket): ChatAddress => contactAddress(ticket.contact, ticket.isGroup);

/** For callers that only have a phone number: uses the stored contact's LID. */
export const numberAddress = async (number: string | number, companyId: number): Promise<ChatAddress> => {
  const digits = `${number}`.replace(/\D/g, "");
  const contact = await Contact.findOne({ where: { number: digits, companyId }, attributes: ["number", "lid"] });
  return { number: digits, lid: contact?.lid };
};

export const messageRef = (message: {
  messagesWhatsappsId: string;
  remoteJid?: string | null;
  participant?: string | null;
  fromMe?: boolean;
  dataJson?: string | null;
}): MessageRef => ({
  externalId: message.messagesWhatsappsId,
  chatJid: message.remoteJid,
  participant: message.participant,
  fromMe: message.fromMe,
  raw: message.dataJson
});
