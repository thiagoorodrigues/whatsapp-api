import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import { getTicketChannel, ticketAddress } from "../../channels";
import type { GroupParticipant } from "../../channels/types";
import { mentionToken } from "../../helpers/mentions";
import { resolveMentionNames } from "../MessageServices/ResolveMentionsService";

export interface ParticipantView {
  jid: string;
  /** Digits written after "@" in the text. */
  token: string;
  name: string | null;
  phone: string | null;
  isAdmin: boolean;
}

const phoneJid = (phone?: string) => (phone ? `${phone}@s.whatsapp.net` : null);

/** Names each member (by LID or phone) and sorts named members first. */
export const nameParticipants = async (members: GroupParticipant[], companyId: number): Promise<ParticipantView[]> => {
  const names = await resolveMentionNames(
    members.flatMap(p => [p.jid, phoneJid(p.phone)].filter(Boolean) as string[]),
    companyId
  );

  const list = members.map(p => {
    const own = names.get(p.jid);
    const byPhone = phoneJid(p.phone) ? names.get(phoneJid(p.phone) as string) : undefined;
    return {
      jid: p.jid,
      token: mentionToken(p.jid),
      name: own?.name || byPhone?.name || null,
      phone: p.phone || own?.phone || byPhone?.phone || null,
      isAdmin: p.isAdmin
    };
  });

  return list.sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    return (a.name || a.phone || a.token).localeCompare(b.name || b.phone || b.token, "pt-BR");
  });
};

/** Members of a group ticket with their names, to mention them. */
const ListGroupParticipantsService = async (ticket: Ticket): Promise<ParticipantView[]> => {
  if (!ticket.isGroup) throw new AppError("ERR_TICKET_NOT_GROUP", 400);

  const channel = await getTicketChannel(ticket);
  const members = (await channel.groupParticipants(ticketAddress(ticket))).filter(p => !p.isMe);
  return nameParticipants(members, ticket.companyId);
};

export default ListGroupParticipantsService;
