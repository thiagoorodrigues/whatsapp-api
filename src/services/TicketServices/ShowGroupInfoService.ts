import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import { getTicketChannel, ticketAddress } from "../../channels";
import { nameParticipants, ParticipantView } from "./ListGroupParticipantsService";

export interface GroupMemberView extends ParticipantView {
  isMe: boolean;
  /** Platform contact with this number or LID, when there is one. */
  contactId: number | null;
  profilePicUrl: string | null;
}

export interface GroupInfoView {
  subject: string;
  description: string | null;
  createdAt: Date | null;
  size: number;
  participants: GroupMemberView[];
}

/** Name, description and members of a group ticket: the account itself first, then admins. */
const ShowGroupInfoService = async (ticket: Ticket): Promise<GroupInfoView> => {
  if (!ticket.isGroup) throw new AppError("ERR_TICKET_NOT_GROUP", 400);

  const channel = await getTicketChannel(ticket);
  const info = await channel.groupInfo(ticketAddress(ticket));

  const named = await nameParticipants(info.participants, ticket.companyId);
  const me = new Set(info.participants.filter(p => p.isMe).map(p => p.jid));
  const lids = info.participants.map(p => p.lid).filter(Boolean) as string[];
  const phones = named.map(p => p.phone).filter(Boolean) as string[];

  const contacts = lids.length || phones.length
    ? await Contact.findAll({
        where: {
          companyId: ticket.companyId,
          [Op.or]: [{ number: { [Op.in]: phones } }, { lid: { [Op.in]: lids } }]
        },
        attributes: ["id", "number", "lid", "profilePicUrl"]
      })
    : [];

  const participants = named.map(p => {
    const lid = info.participants.find(m => m.jid === p.jid)?.lid;
    const contact = contacts.find(c => lid && c.lid === lid) || contacts.find(c => p.phone && c.number === p.phone);
    return {
      ...p,
      isMe: me.has(p.jid),
      contactId: contact?.id || null,
      profilePicUrl: contact?.profilePicUrl || null
    };
  });

  const rank = (p: GroupMemberView) => (p.isMe ? 0 : p.isAdmin ? 1 : 2);
  participants.sort((a, b) => rank(a) - rank(b));

  return {
    subject: info.subject,
    description: info.description,
    createdAt: info.createdAt,
    size: participants.length,
    participants
  };
};

export default ShowGroupInfoService;
