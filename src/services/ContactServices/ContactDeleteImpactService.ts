import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

export interface ContactDeleteImpact {
  contacts: number;
  tickets: number;
  messages: number;
}

/**
 * What deleting these contacts takes with it: their tickets and the
 * messages of those tickets are deleted in cascade by the database.
 */
const ContactDeleteImpactService = async (contactIds: number[], companyId: number): Promise<ContactDeleteImpact> => {
  const ids = contactIds.map(Number).filter(Boolean).slice(0, 5000);
  if (!ids.length) return { contacts: 0, tickets: 0, messages: 0 };

  const contacts = await Contact.count({ where: { id: ids, companyId } });
  const tickets = await Ticket.findAll({ where: { contactId: ids, companyId }, attributes: ["id"] });
  const ticketIds = tickets.map(t => t.id);
  const messages = ticketIds.length ? await Message.count({ where: { ticketId: ticketIds, companyId } }) : 0;

  return { contacts, tickets: ticketIds.length, messages };
};

export default ContactDeleteImpactService;
