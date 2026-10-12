import { jidNormalizedUser, proto, WASocket } from "@whiskeysockets/baileys";
import { lookupPhoneJidByLid } from "../../helpers/lidLookup";
import { getGroupMetadata } from "../../libs/whatsappCache";
import {
  getParticipantPhoneJid,
  getRemotePhoneJid,
  isLidJid,
  resolvePhoneJid,
  toUserLid
} from "../../helpers/GetPhoneJid";
import { logger } from "../../utils/logger";
import { InboundKind, InboundMessage } from "../inbound";
import {
  downloadMedia,
  editedMessageId,
  getBodyMessage,
  getQuotedMessageId,
  isForwardedMessage,
  getTypeMessage,
  hasMediaContent,
  isValidMsg,
  mediaInfo
} from "./parse";
import { getMentionedJids } from "../../helpers/mentions";

type Session = WASocket & { id?: number };

const KIND_BY_TYPE: Record<string, InboundKind> = {
  conversation: "text",
  extendedTextMessage: "text",
  editedMessage: "text",
  protocolMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  documentWithCaptionMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  liveLocationMessage: "location",
  contactMessage: "contact",
  contactsArrayMessage: "contacts"
};

// Who wrote it. Senders arrive as LIDs (`@lid`); incoming messages carry the
// phone in key.senderPn, outgoing ones from another linked device do not, so
// a LID seen before is used. Contacts are keyed by phone number: skipping
// this makes the same person two contacts and two tickets.
const senderOf = async (msg: proto.IWebMessageInfo, wbot: Session, companyId: number) => {
  const isGroup = !!msg.key.remoteJid?.endsWith("@g.us");
  if (!isGroup) {
    const phoneJid = await resolvePhoneJid(msg.key, lid => lookupPhoneJidByLid(lid, companyId));
    return {
      jid: phoneJid,
      // Our own messages must not rename the contact after us.
      name: msg.key.fromMe ? phoneJid.replace(/\D/g, "") : msg.pushName || undefined,
      lid: isLidJid(msg.key.remoteJid) ? msg.key.remoteJid : undefined
    };
  }

  if (msg.key.fromMe) {
    return { jid: jidNormalizedUser(wbot.user.id), name: wbot.user.name || undefined };
  }
  // A group member: phone when WhatsApp sends it or we saw that LID before.
  let sender = jidNormalizedUser(
    (msg as any).participant || getParticipantPhoneJid(msg.key) || getRemotePhoneJid(msg.key)
  );
  if (isLidJid(sender)) sender = (await lookupPhoneJidByLid(toUserLid(sender), companyId)) || sender;
  return {
    jid: sender,
    name: msg.pushName || undefined,
    lid: isLidJid(msg.key.participant) ? toUserLid(msg.key.participant) : undefined
  };
};

/**
 * Baileys message -> InboundMessage. Returns null for what the platform
 * ignores (status broadcasts, unsupported types).
 */
const toInbound = async (msg: proto.IWebMessageInfo, wbot: Session, companyId: number): Promise<InboundMessage | null> => {
  if (!isValidMsg(msg)) return null;

  const isGroup = !!msg.key.remoteJid?.endsWith("@g.us");
  const channelType = getTypeMessage(msg);

  let groupName: string | undefined;
  if (isGroup) {
    try {
      groupName = (await getGroupMetadata(wbot, msg.key.remoteJid)).subject;
    } catch (err) {
      logger.warn(`Group metadata unavailable for ${msg.key.remoteJid}: ${err}`);
    }
  }

  const hasMedia = hasMediaContent(msg);
  const loadMedia = async () => {
    const info = mediaInfo(msg);
    const data = info ? await downloadMedia(msg, wbot) : null;
    return info && data ? { data, mimetype: info.mimetype, fileName: info.fileName } : null;
  };

  let quotedExternalId: string | undefined;
  try {
    quotedExternalId = getQuotedMessageId(msg) || undefined;
  } catch (e) {
    // messages without content have no quote
  }

  const kind: InboundKind = KIND_BY_TYPE[channelType] || "other";

  return {
    connectionId: wbot.id,
    companyId,
    externalId: msg.key.id,
    fromMe: !!msg.key.fromMe,
    timestamp: Number(msg.messageTimestamp || 0) * 1000 || Date.now(),
    chat: { jid: msg.key.remoteJid, isGroup, name: groupName },
    sender: await senderOf(msg, wbot, companyId),
    kind,
    channelType,
    text: getBodyMessage(msg) || "",
    hasMedia,
    loadMedia: hasMedia ? loadMedia : undefined,
    quotedExternalId,
    forwarded: isForwardedMessage(msg),
    editOf: editedMessageId(msg),
    mentions: getMentionedJids(msg.message),
    raw: msg
  };
};

export default toInbound;
