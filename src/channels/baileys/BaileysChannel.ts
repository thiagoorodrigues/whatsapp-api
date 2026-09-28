import fs from "fs";
import type { AnyMessageContent, WAMessage, WASocket } from "@whiskeysockets/baileys";
import { getWbot } from "../../libs/wbot";
import { getContactJid } from "../../helpers/GetPhoneJid";
import { markSentByPlatform, newMessageId } from "./sentByPlatform";
import {
  ChatAddress,
  MediaSource,
  MessageRef,
  MessagingChannel,
  NumberCheck,
  OutgoingContent,
  Presence,
  SendOptions,
  SentMessage
} from "../types";

type Session = WASocket & { id?: number };

const media = (source: MediaSource): Buffer | { url: string } => {
  if ("buffer" in source) return source.buffer;
  if ("path" in source) return fs.readFileSync(source.path);
  return { url: source.url };
};

/** Channel content -> Baileys message content. */
export const toBaileysContent = (content: OutgoingContent): AnyMessageContent => {
  switch (content.type) {
    case "text":
      return { text: content.text };
    case "image":
      return { image: media(content), caption: content.caption };
    case "video":
      return { video: media(content), caption: content.caption, fileName: content.fileName };
    case "audio":
      return { audio: media(content), mimetype: content.mimetype || "audio/mp4", ptt: content.voice !== false };
    case "document":
      return {
        document: media(content),
        caption: content.caption,
        fileName: content.fileName,
        mimetype: content.mimetype || "application/octet-stream"
      };
    default:
      throw new Error(`Unsupported content: ${(content as any).type}`);
  }
};

export const jidOf = (to: ChatAddress): string => {
  if (to.jid) return to.jid;
  return getContactJid({ number: `${to.number || ""}`, lid: to.lid }, !!to.isGroup);
};

// Quoting needs the original message (Message.dataJson).
const quotedOf = (ref?: MessageRef): WAMessage | undefined => {
  if (!ref?.raw) return undefined;
  try {
    const stored = JSON.parse(ref.raw);
    return stored?.key ? (stored as WAMessage) : undefined;
  } catch (e) {
    return undefined;
  }
};

/** WhatsApp Web through Baileys; the socket lives in this process (libs/wbot). */
class BaileysChannel implements MessagingChannel {
  readonly kind = "baileys" as const;

  constructor(readonly connectionId: number) {
    // Fails now, like getWbot did, when the connection has no session here.
    this.socket();
  }

  // Looked up on every call: a reconnect replaces the socket.
  private socket(): Session {
    return getWbot(this.connectionId);
  }

  isReady(): boolean {
    try {
      return !!this.socket().user?.id;
    } catch (e) {
      return false;
    }
  }

  // Group ids stored without the "-" of older WhatsApp group ids
  // ("<phone>-<time>@g.us") are matched against the groups the account is
  // in. Current ids ("120363...@g.us") have no dash and go out as stored.
  private async groupJid(jid: string): Promise<string> {
    if (jid.includes("-") || /^120363\d+@g\.us$/.test(jid)) return jid;
    const groups = Object.keys(await this.socket().groupFetchAllParticipating());
    let found = jid;
    groups.forEach(item => {
      const position = item.indexOf("-");
      if (position > 0 && item.replace("-", "") === jid) {
        found = `${jid.substr(0, position)}-${jid.substr(position)}`;
      }
    });
    if (!groups.includes(found)) throw new Error("Group not found");
    return found;
  }

  async send(to: ChatAddress, content: OutgoingContent, options: SendOptions = {}): Promise<SentMessage> {
    const jid = to.isGroup && !to.jid ? await this.groupJid(jidOf(to)) : jidOf(to);
    const quoted = quotedOf(options.quoted);
    // The id is chosen here so the echo can be recognized even if it
    // arrives before sendMessage returns.
    const messageId = newMessageId();
    if (!options.processEcho) markSentByPlatform(messageId);
    const sent = await this.socket().sendMessage(jid, toBaileysContent(content), {
      messageId,
      ...(quoted ? { quoted } : {})
    });
    return { externalId: sent?.key?.id || messageId, chatJid: sent?.key?.remoteJid || jid, raw: sent };
  }

  async deleteMessage(chat: ChatAddress, message: MessageRef): Promise<void> {
    const jid = message.chatJid || jidOf(chat);
    await this.socket().sendMessage(jid, {
      delete: {
        id: message.externalId,
        remoteJid: jid,
        participant: message.participant || undefined,
        fromMe: message.fromMe
      }
    });
  }

  // Read receipts (readMessages) reach the sender and the account's other
  // devices; chatModify markRead needs app state keys sessions often lack.
  async markRead(chat: ChatAddress, messages: MessageRef[]): Promise<void> {
    const keys = messages
      .filter(m => m.externalId && m.fromMe !== true)
      .map(m => {
        const stored = quotedOf(m);
        return {
          remoteJid: stored?.key?.remoteJid || m.chatJid || jidOf(chat),
          id: m.externalId,
          participant: stored?.key?.participant || m.participant || undefined,
          fromMe: false
        };
      });
    if (keys.length) await this.socket().readMessages(keys);
  }

  async setPresence(presence: Presence): Promise<void> {
    const socket = this.socket();
    if (!socket.user?.id) return;
    await socket.sendPresenceUpdate(presence, socket.user.id);
  }

  async checkNumber(number: string): Promise<NumberCheck> {
    const digits = `${number}`.replace(/\D/g, "");
    const [result] = (await this.socket().onWhatsApp(`${digits}@s.whatsapp.net`)) || [];
    return result?.exists ? { exists: true, jid: result.jid } : { exists: false };
  }

  async profilePictureUrl(chat: ChatAddress): Promise<string | null> {
    try {
      return (await this.socket().profilePictureUrl(jidOf(chat))) || null;
    } catch (e) {
      return null;
    }
  }
}

export default BaileysChannel;
