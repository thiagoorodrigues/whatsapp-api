import { Chat, Contact } from "@whiskeysockets/baileys";
import Baileys from "../../models/Baileys";
import { isArray } from "lodash";
import { logger } from "../../utils/logger";

interface Request {
  whatsappId: number;
  contacts?: Contact[];
  chats?: Chat[];
}

const isJsonString = (str: string) => {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

const createOrUpdateBaileysService = async ({
  whatsappId,
  contacts,
  chats
}: Request): Promise<Baileys> => {
  try {
    const baileysExists = await Baileys.findOne({
      where: { whatsappId }
    });

    logger.info(`baileysExists.chats: ${baileysExists.chats.includes('\\')}`);
    logger.info(`baileysExists.contacts: ${baileysExists.contacts}`);

    if (baileysExists) {
      const getChats = baileysExists.chats && isJsonString(JSON.stringify(baileysExists.chats))
        ? JSON.parse(JSON.stringify(baileysExists.chats))
        : [];

      const getContacts = baileysExists.contacts && isJsonString(JSON.stringify(baileysExists.contacts))
        ? JSON.parse(JSON.stringify(baileysExists.contacts))
        : [];

      if (chats && isArray(getChats)) {
        getChats.push(...chats);
        getChats.sort();
        getChats.filter((v, i, a) => a.indexOf(v) === i);
      }

      if (contacts && isArray(getContacts)) {
        getContacts.push(...contacts);
        getContacts.sort();
        getContacts.filter((v, i, a) => a.indexOf(v) === i);
      }

      logger.info(`getChats: ${getChats}`);
      logger.info(`getContacts: ${getContacts}`);

      const newBaileys = await baileysExists.update({
        chats: JSON.stringify(getChats),
        contacts: JSON.stringify(getContacts)
      });

      return newBaileys;
    }

    const baileys = await Baileys.create({
      whatsappId,
      contacts: JSON.stringify(contacts),
      chats: JSON.stringify(chats)
    });

    return baileys;
  } catch (err) {
    logger.info(`baileysExists: ${err}`);
  }
};

export default createOrUpdateBaileysService;
