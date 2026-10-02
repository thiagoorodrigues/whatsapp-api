import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import { isNil } from "lodash";
import { logger } from "../../utils/logger";
import { companyRoom } from "../../libs/socketRooms";
interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  whatsappId?: number;
  lid?: string;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  profilePicUrl,
  isGroup,
  email = "",
  companyId,
  extraInfo = [],
  whatsappId,
  lid
}: Request): Promise<Contact> => {
  const number = isGroup ? rawNumber : rawNumber.replace(/[^0-9]/g, "");

  const io = getIO();
  let contact: Contact | null;

  contact = await Contact.findOne({
    where: {
      number,
      companyId
    }
  });

  if (contact) {
    contact.update({ profilePicUrl });

    // Contacts created without a name got the number as name; take the
    // WhatsApp name when it arrives. Names typed in the platform stay.
    if (!isGroup && name && name !== number && (!contact.name || contact.name === contact.number)) {
      contact.update({ name });
    }

    if (lid && contact.lid !== lid) {
      contact.update({ lid });
    }

    if (isNil(contact.whatsappId === null) && whatsappId) {
      contact.update({
        whatsappId
      });
    }

    io.to(companyRoom(companyId)).emit(`company-${companyId}-contact`, {
      action: "update",
      contact
    });
  } else {
    contact = await Contact.create({
      name,
      number,
      profilePicUrl,
      email,
      isGroup,
      extraInfo,
      companyId,
      whatsappId,
      lid
    });

    io.to(companyRoom(companyId)).emit(`company-${companyId}-contact`, {
      action: "create",
      contact
    });
  }

  return contact;
};

export default CreateOrUpdateContactService;
