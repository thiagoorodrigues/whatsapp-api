import * as Sentry from "@sentry/node";
import {
  downloadMediaMessage,
  extractMessageContent,
  getContentType,
  proto,
  WAMessage,
  WAMessageStubType
} from "@whiskeysockets/baileys";
import { logger } from "../../utils/logger";

// Reading Baileys (WhatsApp Web) messages: type, text shown in the ticket,
// quoted message, media. Moved from wbotMessageListener unchanged.

export const getTypeMessage = (msg: proto.IWebMessageInfo): string => {
  return getContentType(msg.message);
};

const getBodyButton = (msg: proto.IWebMessageInfo): string => {
  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText) {
    let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.buttonsMessage?.contentText}*`;

    for (const buton of msg.message?.viewOnceMessage?.message?.buttonsMessage?.buttons) {
      bodyMessage += `\n\n${buton.buttonText?.displayText}`;
    }
    return bodyMessage;
  }

  if (msg.key.fromMe && msg?.message?.viewOnceMessage?.message?.listMessage) {
    let bodyMessage = `*${msg?.message?.viewOnceMessage?.message?.listMessage?.description}*`;
    for (const buton of msg.message?.viewOnceMessage?.message?.listMessage?.sections) {
      for (const rows of buton.rows) {
        bodyMessage += `\n\n${rows.title}`;
      }
    }

    return bodyMessage;
  }
};

const msgLocation = (image, latitude, longitude) => {
  if (image) {
    var b64 = Buffer.from(image).toString("base64");

    let data = `data:image/png;base64, ${b64} | https://maps.google.com/maps?q=${latitude}%2C${longitude}&z=17&hl=pt-BR|${latitude}, ${longitude} `;
    return data;
  }
};

const getContactVCard = (vCard): string => {
  let array = vCard.split("\n");
  let obj = [];
  let contact = "";
  for (let index = 0; index < array.length; index++) {
    const v = array[index];
    let values = v.split(":");
    for (let ind = 0; ind < values.length; ind++) {
      if (values[ind].indexOf("+") !== -1) {
        obj.push({ number: values[ind] });
      }
      if (values[ind].indexOf("FN") !== -1) {
        contact = values[ind + 1];
      }
    }
  }
  return `${obj[0].number.replace("+", "")}/${contact}`;
}

const getMultContactVCard = (vCard): string => {
  if (vCard.contacts && vCard.contacts.length > 0) {
    let contact = "";
    for (let index = 0; index < vCard.contacts.length; index++) {
      contact += getContactVCard(vCard.contacts[index].vcard) + (vCard.contacts.length != (index + 1) ? "_" : "");
    }
    return contact;
  }

  return "";
}

export const getBodyMessage = (msg: proto.IWebMessageInfo): string | null => {

  try {
    let type = getTypeMessage(msg);

    const types = {
      conversation: msg?.message?.conversation,
      editedMessage: msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage?.conversation ? msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage?.conversation :
        (msg?.message?.protocolMessage?.editedMessage?.imageMessage?.caption || (msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage?.imageMessage?.caption || msg.message?.protocolMessage?.key?.id)),
      imageMessage: msg.message?.imageMessage?.caption,
      videoMessage: msg.message?.videoMessage?.caption,
      extendedTextMessage: msg.message?.extendedTextMessage?.text,
      buttonsResponseMessage: msg.message?.buttonsResponseMessage?.selectedButtonId,
      templateButtonReplyMessage: msg.message?.templateButtonReplyMessage?.selectedId,
      messageContextInfo: msg.message?.buttonsResponseMessage?.selectedButtonId || msg.message?.listResponseMessage?.title,
      buttonsMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      viewOnceMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      stickerMessage: "sticker",
      contactMessage: msg.message?.contactMessage?.vcard ? getContactVCard(msg.message?.contactMessage?.vcard) : "",
      contactsArrayMessage: msg.message?.contactsArrayMessage ? getMultContactVCard(msg.message?.contactsArrayMessage) : "",
      //locationMessage: `Latitude: ${msg.message.locationMessage?.degreesLatitude} - Longitude: ${msg.message.locationMessage?.degreesLongitude}`,
      locationMessage: msgLocation(
        msg.message?.locationMessage?.jpegThumbnail,
        msg.message?.locationMessage?.degreesLatitude,
        msg.message?.locationMessage?.degreesLongitude
      ),
      liveLocationMessage: `Latitude: ${msg.message?.liveLocationMessage?.degreesLatitude} - Longitude: ${msg.message?.liveLocationMessage?.degreesLongitude}`,
      documentMessage: msg.message?.documentMessage?.title,
      documentWithCaptionMessage: msg.message?.documentWithCaptionMessage?.message?.documentMessage?.caption,
      audioMessage: "Áudio",
      listMessage: getBodyButton(msg) || msg.message?.listResponseMessage?.title,
      listResponseMessage: msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId,
      reactionMessage: msg.message?.reactionMessage?.text || "reaction",
      protocolMessage: msg.message?.protocolMessage?.editedMessage?.conversation ? msg.message?.protocolMessage?.editedMessage?.conversation :
        (msg?.message?.protocolMessage?.editedMessage?.imageMessage?.caption || (msg?.message?.editedMessage?.message?.protocolMessage?.editedMessage?.imageMessage?.caption || msg.message?.protocolMessage?.key?.id))
    };

    const objKey = Object.keys(types).find(key => key === type);

    if (!objKey) {
      logger.warn(`#### Nao achou o type 152: ${type} ${JSON.stringify(msg)}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, type });
      Sentry.captureException(
        new Error("Novo Tipo de Mensagem em getTypeMessage")
      );
    }
    return types[type];
  } catch (error) {
    Sentry.setExtra("Error getTypeMessage", { msg, BodyMsg: msg.message });
    Sentry.captureException(error);
    console.log(error);
  }
};

export const getQuotedMessageId = (msg: proto.IWebMessageInfo) => {
  const body = extractMessageContent(msg.message)[
    Object.keys(msg?.message).values().next().value
  ];

  return body?.contextInfo?.stanzaId;
};

export const isValidMsg = (msg: proto.IWebMessageInfo): boolean => {
  if (msg.key.remoteJid === "status@broadcast") return false;
  try {
    const msgType = getTypeMessage(msg);
    if (!msgType) {
      return;
    }

    const ifType =
      msgType === "conversation" ||
      msgType === "extendedTextMessage" ||
      msgType === "editedMessage" ||
      msgType === "audioMessage" ||
      msgType === "videoMessage" ||
      msgType === "imageMessage" ||
      msgType === "documentMessage" ||
      msgType === "documentWithCaptionMessage" ||
      msgType === "stickerMessage" ||
      msgType === "buttonsResponseMessage" ||
      msgType === "buttonsMessage" ||
      msgType === "messageContextInfo" ||
      msgType === "locationMessage" ||
      msgType === "liveLocationMessage" ||
      msgType === "contactMessage" ||
      msgType === "voiceMessage" ||
      msgType === "mediaMessage" ||
      msgType === "contactsArrayMessage" ||
      msgType === "reactionMessage" ||
      msgType === "ephemeralMessage" ||
      msgType === "protocolMessage" ||
      msgType === "listResponseMessage" ||
      msgType === "listMessage" ||
      msgType === "viewOnceMessage";

    if (!ifType) {
      logger.warn(`#### Nao achou o type em isValidMsg: ${msgType}
${JSON.stringify(msg?.message)}`);
      Sentry.setExtra("Mensagem", { BodyMsg: msg.message, msg, msgType });
      Sentry.captureException(new Error("Novo Tipo de Mensagem em isValidMsg"));
    }

    return !!ifType;
  } catch (error) {
    Sentry.setExtra("Error isValidMsg", { msg });
    Sentry.captureException(error);
  }
};

export const filterMessages = (msg: WAMessage): boolean => {
  if (msg.message?.protocolMessage?.editedMessage) return true;
  if (msg.message?.protocolMessage) return false;

  if (
    [
      WAMessageStubType.REVOKE,
      WAMessageStubType.E2E_DEVICE_CHANGED,
      WAMessageStubType.E2E_IDENTITY_CHANGED,
      WAMessageStubType.CIPHERTEXT
    ].includes(msg.messageStubType as proto.WebMessageInfo.StubType)
  )
    return false;

  return true;
};

const MEDIA_TYPES = [
  "imageMessage",
  "audioMessage",
  "videoMessage",
  "documentMessage",
  "documentWithCaptionMessage",
  "stickerMessage"
];

export const hasMediaContent = (msg: proto.IWebMessageInfo): boolean =>
  MEDIA_TYPES.some(type => !!msg.message?.[type]);

/** Id of the message an edit replaces, when this is an edit. */
export const editedMessageId = (msg: proto.IWebMessageInfo): string | undefined => {
  const type = getTypeMessage(msg);
  if (!["protocolMessage", "editedMessage"].includes(type)) return undefined;
  return (
    msg?.message?.protocolMessage?.key?.id ||
    msg?.message?.editedMessage?.message?.protocolMessage?.key?.id ||
    undefined
  );
};

export const mediaInfo = (msg: proto.IWebMessageInfo): { mimetype: string; fileName: string } | null => {
  const content =
    msg.message?.imageMessage ||
    msg.message?.audioMessage ||
    msg.message?.videoMessage ||
    msg.message?.stickerMessage ||
    msg.message?.documentMessage ||
    msg.message?.documentWithCaptionMessage?.message?.documentMessage;
  if (!content?.mimetype) return null;
  const original = (content as proto.Message.IDocumentMessage).fileName || "";
  const ext = content.mimetype.split("/")[1]?.split(";")[0] || "bin";
  return { mimetype: content.mimetype, fileName: original || `${Date.now()}.${ext}` };
};

/** Media bytes, or null when WhatsApp no longer has them. */
export const downloadMedia = async (msg: proto.IWebMessageInfo): Promise<Buffer | null> => {
  try {
    return (await downloadMediaMessage(msg as WAMessage, "buffer", {})) as Buffer;
  } catch (err) {
    logger.warn(`Could not download media of message ${msg.key?.id}: ${err}`);
    return null;
  }
};
