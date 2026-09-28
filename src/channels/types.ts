// Messaging channel of a connection (Whatsapp row), independent of how it
// talks to WhatsApp. Today the only channel is Baileys (WhatsApp Web);
// the Meta Cloud API will be a second implementation of the same interface.

/** Who to talk to: a contact (phone and, on WhatsApp Web, its LID) or a group. */
export interface ChatAddress {
  number?: string | null;
  lid?: string | null;
  isGroup?: boolean;
  /** Channel-native address, when already known (e.g. a WhatsApp JID). */
  jid?: string | null;
}

export type MediaSource = { buffer: Buffer } | { path: string } | { url: string };

export type OutgoingContent =
  | { type: "text"; text: string }
  | ({ type: "image"; caption?: string } & MediaSource)
  | ({ type: "video"; caption?: string; fileName?: string } & MediaSource)
  | ({ type: "audio"; mimetype?: string; voice?: boolean } & MediaSource)
  | ({ type: "document"; caption?: string; fileName?: string; mimetype?: string } & MediaSource);

/** A message already stored (Message row), as the channel needs to refer to it. */
export interface MessageRef {
  externalId: string;
  chatJid?: string | null;
  fromMe?: boolean;
  participant?: string | null;
  /** Raw channel payload (Message.dataJson), when the channel needs it. */
  raw?: string | null;
}

export interface SendOptions {
  quoted?: MessageRef;
}

export interface SentMessage {
  /** Id of the message on the channel (Message.messagesWhatsappsId). */
  externalId: string | null;
  /**
   * Channel payload of the sent message. Baileys callers still hand it to
   * verifyMessage until messages are saved on send.
   */
  raw?: any;
}

export interface NumberCheck {
  exists: boolean;
  /** Channel-native address of the number, when it exists. */
  jid?: string;
}

export type Presence = "available" | "unavailable";

export interface MessagingChannel {
  readonly kind: "baileys";
  readonly connectionId: number;
  /** Connected and authenticated. */
  isReady(): boolean;
  send(to: ChatAddress, content: OutgoingContent, options?: SendOptions): Promise<SentMessage>;
  deleteMessage(chat: ChatAddress, message: MessageRef): Promise<void>;
  /** Marks the chat read up to `lastMessage` (a received message). */
  markRead(chat: ChatAddress, lastMessage: MessageRef): Promise<void>;
  setPresence(presence: Presence): Promise<void>;
  checkNumber(number: string): Promise<NumberCheck>;
  profilePictureUrl(chat: ChatAddress): Promise<string | null>;
}
