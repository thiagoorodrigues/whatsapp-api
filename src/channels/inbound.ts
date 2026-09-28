// A message received on a connection, in a form that does not depend on
// the channel (Baileys today, Meta Cloud API later). The business pipeline
// (services/InboundServices) only sees this.

export type InboundKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "contacts"
  | "other";

export interface InboundMedia {
  data: Buffer;
  mimetype: string;
  fileName: string;
}

export interface InboundMessage {
  connectionId: number;
  companyId: number;
  /** Id of the message on the channel (Message.messagesWhatsappsId). */
  externalId: string;
  /** Sent by this account (from the phone or another linked device). */
  fromMe: boolean;
  /** Epoch milliseconds. */
  timestamp: number;
  chat: {
    /** Channel-native id of the chat (the group, in groups). */
    jid: string;
    isGroup: boolean;
    /** Group subject. */
    name?: string;
  };
  /** Who wrote it: the contact, or the member in a group. */
  sender: {
    /** Phone JID when known, otherwise the LID. */
    jid: string;
    name?: string;
    lid?: string;
  };
  kind: InboundKind;
  /**
   * Type as the channel names it (stored as Message.mediaType for non-media
   * messages; the frontend renders locationMessage, contactMessage, ...).
   */
  channelType: string;
  /**
   * Text shown in the ticket. Location and contact cards keep the encodings
   * the frontend parses ("thumb | url|lat, lng", "number/name").
   */
  text: string;
  /** Carries a file (image, audio, video, document, sticker). */
  hasMedia: boolean;
  /**
   * Downloads the file; null when the channel no longer has it. Called only
   * for messages that will be saved.
   */
  loadMedia?: () => Promise<InboundMedia | null>;
  quotedExternalId?: string;
  /** Set when this is an edit: id of the message edited. */
  editOf?: string;
  /** Channel-native ids of the people mentioned ("@name" in groups). */
  mentions: string[];
  /** Channel payload, saved as Message.dataJson and sent to webhooks. */
  raw: unknown;
}

/** Channel-neutral view sent to webhooks (n8n) next to the raw payload. */
export const normalizedForWebhook = (inbound: InboundMessage) => ({
  id: inbound.externalId,
  connectionId: inbound.connectionId,
  fromMe: inbound.fromMe,
  timestamp: inbound.timestamp,
  chat: inbound.chat,
  sender: inbound.sender,
  type: inbound.kind,
  text: inbound.text,
  quotedId: inbound.quotedExternalId || null,
  editOf: inbound.editOf || null,
  mentions: inbound.mentions || [],
  hasMedia: inbound.hasMedia
});
