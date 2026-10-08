import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import User from "../models/User";
import Queue from "../models/Queue";
import Whatsapp from "../models/Whatsapp";
import Company from "../models/Company";
import Message from "../models/Message";

// Message variables ({{name}}, {{protocol}}...). Dates and greetings are in
// Brasília time whatever the server timezone. The panel lists the same
// variables in whatsapp-app/src/utils/templateVariables.js.

const TIME_ZONE = "America/Sao_Paulo";
const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const TICKET_STATUS: Record<string, string> = {
  open: "Em atendimento",
  pending: "Aguardando",
  closed: "Resolvido"
};

const pad = (n: number, size = 2): string => String(n).padStart(size, "0");

// Date parts of `date` as seen in Brasília.
const brasilia = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday
  };
};

const dateText = (d: { day: number; month: number; year: number }) => `${pad(d.day)}-${pad(d.month)}-${d.year}`;

export const greeting = (date = new Date()): string => {
  const { hour } = brasilia(date);
  if (hour < 6) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
};

const dayPeriod = (hour: number): string => {
  if (hour < 6) return "madrugada";
  if (hour < 12) return "manhã";
  if (hour < 18) return "tarde";
  return "noite";
};

export const firstName = (contact?: Contact): string =>
  `${contact?.name || ""}`.trim().split(/\s+/)[0] || "";

const lastName = (contact?: Contact): string => {
  const parts = `${contact?.name || ""}`.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : "";
};

type View = Record<string, string | number>;

// Variables that only need the contact and the clock.
const baseView = (contact?: Contact, now = new Date()): View => {
  const d = brasilia(now);
  const hello = greeting(now);
  const first = firstName(contact);
  const hour = `${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}`;
  return {
    firstName: first,
    lastName: lastName(contact),
    name: contact?.name || "",
    phoneNumber: contact?.number || "",
    email: contact?.email || "",
    contactId: contact?.id || "",
    protocol: `${d.year}${pad(d.month)}${pad(d.day)}${d.hour}${pad(d.minute)}${pad(d.second)}`,
    ms: hello,
    greeting: first ? `${hello}, ${first}` : hello,
    hour,
    date: dateText(d),
    fullDate: `${WEEKDAYS[d.weekday] || ""}, ${dateText(d)}`,
    dayPeriod: dayPeriod(d.hour),
    data_hora: `${dateText(d)} às ${pad(d.hour)}:${pad(d.minute)}`,
    // Older names, kept for messages that already use them.
    gretting: hello,
    hora: hour
  };
};

// Only the known variables ({{name}}, {{ name }}, {{{name}}}) are filled; any
// other braces stay as typed. Mustache.render threw on code with "{{#each}}"
// or "{{/if}}" and blanked "{{ item.name }}" in texts attendants paste.
// No HTML escaping: WhatsApp is plain text.
const TAG = /\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g;

const render = (body: string, view: View): string =>
  body.replace(TAG, (tag: string, triple?: string, plain?: string) => {
    const key = triple || plain;
    return Object.prototype.hasOwnProperty.call(view, key) ? String(view[key]) : tag;
  });

export default (body: string, contact: Contact, extra: View = {}): string =>
  render(body, { ...baseView(contact), ...extra });

const companyDueDate = (dueDate?: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(`${dueDate || ""}`);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
};

// Variables of the ticket: attendant, queue, connection, company, the
// customer's last message.
export const ticketVariables = async (ticket: Ticket): Promise<View> => {
  const [user, queue, whatsapp, company, last] = await Promise.all([
    ticket.userId ? User.findByPk(ticket.userId, { attributes: ["name"] }) : null,
    ticket.queueId ? Queue.findByPk(ticket.queueId, { attributes: ["name"] }) : null,
    ticket.whatsappId ? Whatsapp.findByPk(ticket.whatsappId, { attributes: ["name"] }) : null,
    Company.findByPk(ticket.companyId, { attributes: ["name", "email", "dueDate"] }),
    Message.findOne({
      where: { ticketId: ticket.id, fromMe: false, isPrivate: false },
      attributes: ["body"],
      order: [["createdAt", "DESC"]]
    })
  ]);
  return {
    ticket_id: ticket.id,
    formattedTicketId: pad(ticket.id, 6),
    ticketStatus: TICKET_STATUS[ticket.status] || ticket.status || "",
    user: user?.name || "",
    queue: queue?.name || "",
    connection: whatsapp?.name || "",
    lastMessage: last?.body || "",
    name_company: company?.name || "",
    companyEmail: company?.email || "",
    companyDueDate: companyDueDate(company?.dueDate)
  };
};

/** Fills every variable, including the ticket ones (only looked up when used). */
export const formatForTicket = async (body: string, ticket: Ticket, contact = ticket.contact): Promise<string> => {
  if (!body || !body.includes("{{")) return body;
  return render(body, { ...baseView(contact), ...(await ticketVariables(ticket)) });
};

/**
 * Campaign messages: no ticket yet, so contact (from the contact list),
 * company, connection and date variables. The older single-brace ones
 * ({nome}, custom variables) are replaced before, in the campaign queue.
 */
export const formatForCampaign = async (
  body: string,
  { contact, companyId, connectionName }: { contact?: { name?: string; number?: string; email?: string } | null; companyId: number; connectionName?: string }
): Promise<string> => {
  if (!body || !body.includes("{{")) return body;
  const company = await Company.findByPk(companyId, { attributes: ["name", "email", "dueDate"] });
  return render(body, {
    ...baseView(contact as Contact),
    contactId: "",
    connection: connectionName || "",
    name_company: company?.name || "",
    companyEmail: company?.email || "",
    companyDueDate: companyDueDate(company?.dueDate)
  });
};

// Whether the text came from this template, whatever the tags were filled
// with. `exact`: the whole text, not just a part of it.
export const matchesTemplate = (text: string, template: string, exact = false): boolean => {
  const pattern = template
    .split(/{{{?[^}]*}?}}/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*?");
  return new RegExp(exact ? `^${pattern}$` : pattern).test(text);
};
