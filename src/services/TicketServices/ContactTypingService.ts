import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import WhatsappContact from "../../models/WhatsappContact";
import { getIO } from "../../libs/socket";
import { ticketRoom } from "../../libs/socketRooms";
import { getTicketChannel, ticketAddress } from "../../channels";
import { toPhoneNumber, toUserLid } from "../../helpers/GetPhoneJid";
import { logger } from "../../utils/logger";

// "Digitando..." / "gravando áudio..." of the contact, shown in the open
// conversation. WhatsApp only reports it for chats we subscribed to (done
// when someone opens the ticket) and only while the connection shows as
// online (Whatsapps.showOnline).

export type TypingState = "composing" | "recording" | null;

export const typingState = (presence?: string): TypingState =>
  presence === "composing" || presence === "recording" ? presence : null;

export const watchTicketPresence = async (ticket: Ticket): Promise<void> => {
  if (ticket.isGroup || !ticket.contact || !ticket.whatsappId || ticket.status === "closed") return;
  try {
    await (await getTicketChannel(ticket)).watchPresence(ticketAddress(ticket));
  } catch (err) {
    logger.debug(`Presence subscribe failed for ticket ${ticket.id}: ${err}`);
  }
};

// The attendant typing in the panel: the contact sees "digitando..." (or
// "gravando áudio...") on WhatsApp. Best effort, failures are ignored.
export const sendAttendantTyping = async (ticket: Ticket, state: unknown): Promise<void> => {
  if (!ticket.whatsappId || !ticket.contact || ticket.status === "closed") return;
  const typing = state === "recording" ? "recording" : state === "composing";
  try {
    await (await getTicketChannel(ticket)).sendTyping(ticketAddress(ticket), typing);
  } catch (err) {
    logger.debug(`Attendant typing failed for ticket ${ticket.id}: ${err}`);
  }
};

interface PresenceUpdate {
  id: string;
  presences: Record<string, { lastKnownPresence?: string }>;
}

// Contato de um chat 1:1. Chat em LID: tenta Contact.lid e, se não achar, o
// número guardado em WhatsappContacts para o mesmo LID nesta conexão.
const findTypingContact = async (companyId: number, whatsappId: number, chatJid: string) => {
  const lid = chatJid.endsWith("@lid") ? toUserLid(chatJid) : undefined;
  const number = lid ? undefined : toPhoneNumber(chatJid);
  const contact = await Contact.findOne({
    where: { companyId, isGroup: false, ...(lid ? { lid } : { number }) },
    attributes: ["id"]
  });
  if (contact || !lid) return contact;

  const known = await WhatsappContact.findOne({ where: { whatsappId, companyId, lid }, attributes: ["number"] });
  if (!known?.number) return null;
  return Contact.findOne({ where: { companyId, isGroup: false, number: known.number }, attributes: ["id"] });
};

// Entrada neutra (Baileys e gateway): chat e estado já extraídos do evento.
export const handleContactTyping = async ({
  companyId,
  whatsappId,
  chatJid,
  state
}: {
  companyId: number;
  whatsappId: number;
  chatJid: string;
  state?: string | null;
}): Promise<void> => {
  if (!chatJid || !/@(s\.whatsapp\.net|lid)$/.test(chatJid)) return;
  const typing = typingState(state || undefined);

  const contact = await findTypingContact(companyId, whatsappId, chatJid);
  if (!contact) return;

  const tickets = await Ticket.findAll({
    where: { companyId, contactId: contact.id, whatsappId, status: { [Op.ne]: "closed" } },
    attributes: ["id"]
  });
  const io = getIO();
  tickets.forEach(ticket =>
    io.to(ticketRoom(companyId, ticket.id)).emit(`company-${companyId}-typing`, { ticketId: ticket.id, state: typing })
  );
};

// Baileys: extrai chat e estado do presence.update.
export const handlePresenceUpdate = async (
  companyId: number,
  whatsappId: number,
  { id, presences }: PresenceUpdate
): Promise<void> => {
  if (!id || !/@(s\.whatsapp\.net|lid)$/.test(id)) return;
  const entry = presences?.[id] || Object.values(presences || {})[0];
  await handleContactTyping({ companyId, whatsappId, chatJid: id, state: entry?.lastKnownPresence });
};
