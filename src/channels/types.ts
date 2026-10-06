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
  | { type: "text"; text: string; /** Ids of the people mentioned ("@name" in groups). */ mentions?: string[] }
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
  /** Shown as "Encaminhada" (forwarded) to the recipient. */
  forwarded?: boolean;
}

export interface SentMessage {
  /** Id of the message on the channel (Message.messagesWhatsappsId). */
  externalId: string | null;
  /** Channel-native address the message went to (Message.remoteJid). */
  chatJid?: string | null;
  /**
   * Channel payload of the sent message (saved as Message.dataJson; Baileys
   * needs it to quote and resend).
   */
  raw?: any;
}

export interface NumberCheck {
  exists: boolean;
  /** Channel-native address of the number, when it exists. */
  jid?: string;
}

export type Presence = "available" | "unavailable";

/** A member of a group, as the channel knows it. */
export interface GroupParticipant {
  /** Id the group uses for the member (LID or phone JID). */
  jid: string;
  lid?: string;
  /** Phone digits, when known. */
  phone?: string;
  isAdmin: boolean;
  /** The connected account itself. */
  isMe: boolean;
}

/** A group's name, description and members, as the channel knows them. */
export interface GroupInfo {
  subject: string;
  description: string | null;
  /** When the group was created. */
  createdAt: Date | null;
  participants: GroupParticipant[];
}

export interface MessagingChannel {
  readonly kind: "baileys";
  readonly connectionId: number;
  /** Connected and authenticated. */
  isReady(): boolean;
  send(to: ChatAddress, content: OutgoingContent, options?: SendOptions): Promise<SentMessage>;
  deleteMessage(chat: ChatAddress, message: MessageRef): Promise<void>;
  /** Sends read receipts for received messages (the sender sees them read). */
  markRead(chat: ChatAddress, messages: MessageRef[]): Promise<void>;
  setPresence(presence: Presence): Promise<void>;
  /** "Digitando..." shown to the contact while a bot prepares a reply. */
  sendTyping(chat: ChatAddress, typing: boolean | "recording"): Promise<void>;
  /** Asks to be told when the contact is typing (see ContactTypingService). */
  watchPresence(chat: ChatAddress): Promise<void>;
  checkNumber(number: string): Promise<NumberCheck>;
  profilePictureUrl(chat: ChatAddress): Promise<string | null>;
  groupParticipants(chat: ChatAddress): Promise<GroupParticipant[]>;
  groupInfo(chat: ChatAddress): Promise<GroupInfo>;
}
