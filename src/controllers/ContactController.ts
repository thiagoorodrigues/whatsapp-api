import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import ListContactsService from "../services/ContactServices/ListContactsService";
import CreateContactService from "../services/ContactServices/CreateContactService";
import ShowContactService from "../services/ContactServices/ShowContactService";
import UpdateContactService from "../services/ContactServices/UpdateContactService";
import DeleteContactService from "../services/ContactServices/DeleteContactService";
import GetContactService from "../services/ContactServices/GetContactService";
import ContactDeleteImpactService from "../services/ContactServices/ContactDeleteImpactService";

import CheckIsValidContact from "../services/WbotServices/CheckIsValidContact";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import AppError from "../errors/AppError";
import SimpleListService, {
  SearchContactParams
} from "../services/ContactServices/SimpleListService";
import ContactCustomField from "../models/ContactCustomField";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import User from "../models/User";
import { Op } from "sequelize";
import { logger } from "../utils/logger";
import { companyRoom } from "../libs/socketRooms";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

type IndexGetContactQuery = {
  name: string;
  number: string;
};

interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}
interface ContactData {
  name: string;
  number: string;
  email?: string;
  extraInfo?: ExtraInfo[];
  isGroup?: boolean
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;
  const { companyId } = req.user;

  const { contacts, count, hasMore } = await ListContactsService({
    searchParam,
    pageNumber,
    companyId
  });

  return res.json({ contacts, count, hasMore });
};

export const getContact = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { name, number } = req.body as IndexGetContactQuery;
  const { companyId } = req.user;

  const contact = await GetContactService({
    name,
    number,
    companyId
  });

  return res.status(200).json(contact);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const newContact: ContactData = req.body;
  newContact.number = newContact.number.replace("-", "").replace(" ", "");

  const schema = Yup.object().shape({
    name: Yup.string().required(),
    number: Yup.string().required().matches(/^\d+$/, "Invalid number format. Only numbers is allowed.")
  });

  try {
    await schema.validate(newContact);

    // Groups have no phone number to check.
    if (!newContact.isGroup) {
      newContact.number = await CheckIsValidContact(newContact.number, companyId);
    }


  } catch (err: any) {
    throw new AppError(err.message);
  }

  /**
   * Código desabilitado por demora no retorno
   */
  // const profilePicUrl = await GetProfilePicUrl(validNumber.jid, companyId);

  const contact = await CreateContactService({
    ...newContact,
    // profilePicUrl,
    companyId
  });

  const io = getIO();

  io.to(companyRoom(companyId)).emit(`company-${companyId}-contact`, {
    action: "create",
    contact
  });

  return res.status(200).json(contact);
};

// Opens a chat with a contact shared as a vCard: returns the saved contact
// for that number, or creates it. The number is matched as WhatsApp knows it,
// so a vCard with the 9th digit finds a contact saved without it.
export const findOrCreate = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const name = String(req.body.name || "").trim();
  let number = String(req.body.number || "").replace(/\D/g, "");

  if (!number) throw new AppError("ERR_WAPP_INVALID_CONTACT");

  number = await CheckIsValidContact(number, companyId);

  const existing = await Contact.findOne({ where: { number, companyId } });
  if (existing) {
    // Lets the caller jump to a chat already in progress instead of failing
    // on ERR_OTHER_OPEN_TICKET.
    const ticket = await Ticket.findOne({
      where: {
        contactId: existing.id,
        companyId,
        status: { [Op.or]: ["open", "pending"] }
      },
      attributes: ["id", "uuid", "status", "userId"],
      include: [{ model: User, as: "user", attributes: ["id", "name"] }]
    });
    return res.status(200).json({ contact: existing, ticket, created: false });
  }

  const contact = await CreateContactService({
    name: name || number,
    number,
    companyId
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-contact`, {
    action: "create",
    contact
  });

  return res.status(200).json({ contact, ticket: null, created: true });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { contactId } = req.params;
  const { companyId } = req.user;

  const contact = await ShowContactService(contactId, companyId);

  return res.status(200).json(contact);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const contactData: ContactData = req.body;
  const { companyId } = req.user;



  const schema = Yup.object().shape({
    name: Yup.string(),
    number: Yup.string().matches(
      /^\d+$/,
      "Invalid number format. Only numbers is allowed."
    )
  });

  try {

    await schema.validate(contactData);

  } catch (err: any) {
    throw new AppError(err.message);
  }

  if (!contactData.isGroup && contactData.number) {
    contactData.number = await CheckIsValidContact(contactData.number, companyId);
  }

  const { contactId } = req.params;

  const contact = await UpdateContactService({
    contactData,
    contactId,
    companyId
  });

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-contact`, {
    action: "update",
    contact
  });

  return res.status(200).json(contact);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { contactId } = req.params;
  const { companyId } = req.user;

  await ShowContactService(contactId, companyId);

  await DeleteContactService(contactId);

  const io = getIO();
  io.to(companyRoom(companyId)).emit(`company-${companyId}-contact`, {
    action: "delete",
    contactId
  });

  return res.status(200).json({ message: "Contact deleted" });
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const { name } = req.query as unknown as SearchContactParams;
  const { companyId } = req.user;

  const contacts = await SimpleListService({ name, companyId });

  return res.json(contacts);
};

// Tickets and messages that deleting the contacts would take with them
// (shown in the delete confirmation).
export const deleteImpact = async (req: Request, res: Response): Promise<Response> => {
  const ids = Array.isArray(req.body?.contactIds) ? req.body.contactIds : [];
  return res.json(await ContactDeleteImpactService(ids, req.user.companyId));
};
