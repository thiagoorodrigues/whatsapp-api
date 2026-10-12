import path from "path";
import mime from "mime-types";
import AppError from "../../errors/AppError";
import { getContactJid } from "../../helpers/GetPhoneJid";
import { cachedProfilePicture, getGroupMetadata } from "../../libs/whatsappCache";
import { markSentByPlatform } from "../sentByPlatform";
import {
  ChatAddress,
  GroupInfo,
  GroupParticipant,
  MediaSource,
  MessageRef,
  MessagingChannel,
  NumberCheck,
  OutgoingContent,
  Presence,
  SendOptions,
  SentMessage
} from "../types";
import { Address, Content, GatewayClient, gatewayClient, GroupInfo as GatewayGroupInfo, MessageTarget, Quoted } from "./client";
import { stageOutgoing, StagedMedia } from "./media";
import { isReady } from "./state";

// Canal do motor whatsmeow: cada método vira uma rota HTTP do gateway em Go
// (README do weconex-api-meow). Nada aqui importa o Baileys.

// Mimetype padrão quando o conteúdo não traz um e a extensão não diz (o
// gateway exige sempre o tipo).
const DEFAULT_MIMETYPE = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mp4",
  document: "application/octet-stream"
};

const isGroupJid = (jid: string): boolean => jid.endsWith("@g.us");

/** Endereço para os comandos que pedem `chat` (string), como o getContactJid. */
export const jidOf = (to: ChatAddress): string => {
  if (to.jid) return to.jid;
  return getContactJid({ number: `${to.number || ""}`, lid: to.lid }, !!to.isGroup);
};

/** ChatAddress -> `to` do gateway, sem conversão (o gateway resolve na mesma ordem). */
export const toAddress = (to: ChatAddress): Address => {
  if (to.jid) return { jid: to.jid };
  const address: Address = {};
  if (to.number) address.number = `${to.number}`;
  if (to.lid) address.lid = to.lid;
  if (to.isGroup !== undefined) address.isGroup = !!to.isGroup;
  return address;
};

// Quem escreveu a mensagem: só em grupo e quando não é nossa.
const senderOf = (chat: string, ref: MessageRef): string | undefined =>
  isGroupJid(chat) && !ref.fromMe && ref.participant ? ref.participant : undefined;

/** Alvo de apagar/reagir montado das colunas da Message (sem dataJson). */
export const targetOf = (chat: ChatAddress, ref: MessageRef): MessageTarget => {
  const jid = ref.chatJid || jidOf(chat);
  const sender = senderOf(jid, ref);
  return { chat: jid, ...(sender ? { sender } : {}), fromMe: !!ref.fromMe };
};

const quotedOf = (to: ChatAddress, ref: MessageRef): Quoted => {
  const { chat, sender, fromMe } = targetOf(to, ref);
  return {
    id: ref.externalId,
    chat,
    ...(sender ? { sender } : {}),
    fromMe,
    ...(ref.text ? { text: ref.text } : {})
  };
};

// Extensão do arquivo de passagem: nome, caminho ou url; senão pelo mimetype.
const extensionOf = (source: MediaSource, fileName?: string, mimetype?: string): string => {
  const fromName = (name?: string) => (name ? path.extname(name) : "");
  let ext = fromName(fileName);
  if (!ext && "path" in source) ext = fromName(source.path);
  if (!ext && "url" in source) {
    try {
      ext = fromName(new URL(source.url).pathname);
    } catch (e) {
      ext = "";
    }
  }
  if (!ext && mimetype) {
    const byType = mime.extension(mimetype);
    if (byType) ext = `.${byType}`;
  }
  return ext.toLowerCase();
};

const mimetypeOf = (
  type: keyof typeof DEFAULT_MIMETYPE,
  source: MediaSource,
  fileName?: string,
  mimetype?: string
): string => {
  if (mimetype) return mimetype;
  const ext = extensionOf(source, fileName);
  return (ext && mime.lookup(ext)) || DEFAULT_MIMETYPE[type];
};

const sourceOf = (content: Exclude<OutgoingContent, { type: "text" }>): MediaSource => {
  if ("buffer" in content) return { buffer: content.buffer };
  if ("path" in content) return { path: content.path };
  return { url: content.url };
};

/** WhatsApp pelo gateway whatsmeow; o estado da sessão vem de ./state. */
class WhatsmeowChannel implements MessagingChannel {
  readonly kind = "whatsmeow" as const;

  private readonly client: GatewayClient;

  constructor(readonly connectionId: number) {
    // Mesmo contrato do getWbot: sem sessão conectada, falha já aqui.
    this.ensureReady();
    this.client = gatewayClient();
  }

  // Conferido a cada chamada: a conexão pode cair depois de criado o canal.
  private ensureReady(): void {
    if (!isReady(this.connectionId)) throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  isReady(): boolean {
    return isReady(this.connectionId);
  }

  // Monta o `content` do gateway; mídia vai antes para .gateway/out.
  private async toContent(content: OutgoingContent): Promise<{ body: Content; staged?: StagedMedia }> {
    if (content.type === "text") {
      return {
        body: {
          type: "text",
          text: content.text,
          ...(content.mentions?.length ? { mentions: content.mentions } : {})
        }
      };
    }

    const source = sourceOf(content);
    const fileName = content.type === "video" || content.type === "document" ? content.fileName : undefined;
    const mimetype = mimetypeOf(content.type, source, fileName, content.mimetype);
    const staged = await stageOutgoing(source, extensionOf(source, fileName, mimetype));

    const body: Content = { type: content.type };
    if (content.type !== "audio" && content.caption) body.caption = content.caption;
    if (fileName) body.fileName = fileName;
    body.mimetype = mimetype;
    if (content.type === "audio") body.voice = content.voice !== false;
    body.path = staged.path;
    return { body, staged };
  }

  async send(to: ChatAddress, content: OutgoingContent, options: SendOptions = {}): Promise<SentMessage> {
    this.ensureReady();
    const { body, staged } = await this.toContent(content);
    try {
      const sent = await this.client.sendMessage(this.connectionId, {
        to: toAddress(to),
        content: body,
        ...(options.quoted ? { quoted: quotedOf(to, options.quoted) } : {}),
        ...(options.forwarded ? { forwarded: true } : {})
      });
      // O eco (se vier) não pode ser gravado de novo (decisão 7).
      if (sent?.externalId) markSentByPlatform(this.connectionId, sent.externalId);
      return { externalId: sent?.externalId || null, chatJid: sent?.chatJid, raw: sent?.raw };
    } finally {
      if (staged) await staged.cleanup();
    }
  }

  async deleteMessage(chat: ChatAddress, message: MessageRef): Promise<void> {
    this.ensureReady();
    await this.client.revokeMessage(this.connectionId, message.externalId, targetOf(chat, message));
  }

  async edit(chat: ChatAddress, message: MessageRef, text: string): Promise<void> {
    this.ensureReady();
    await this.client.editMessage(this.connectionId, message.externalId, message.chatJid || jidOf(chat), text);
  }

  async react(chat: ChatAddress, message: MessageRef, emoji: string): Promise<void> {
    this.ensureReady();
    await this.client.reactToMessage(this.connectionId, message.externalId, { ...targetOf(chat, message), emoji });
  }

  // Um recibo por (chat, remetente): em grupo o gateway exige o sender.
  async markRead(chat: ChatAddress, messages: MessageRef[]): Promise<void> {
    this.ensureReady();
    const groups = new Map<string, { chat: string; sender?: string; ids: string[] }>();
    messages
      .filter(m => m.externalId && m.fromMe !== true)
      .forEach(m => {
        const { chat: jid, sender } = targetOf(chat, m);
        const key = `${jid}|${sender || ""}`;
        const group = groups.get(key) || { chat: jid, sender, ids: [] };
        group.ids.push(m.externalId);
        groups.set(key, group);
      });
    // eslint-disable-next-line no-restricted-syntax
    for (const group of groups.values()) {
      // eslint-disable-next-line no-await-in-loop
      await this.client.markRead(this.connectionId, group.chat, group.ids, group.sender);
    }
  }

  async setPresence(presence: Presence): Promise<void> {
    this.ensureReady();
    await this.client.setPresence(this.connectionId, presence);
  }

  async sendTyping(chat: ChatAddress, typing: boolean | "recording"): Promise<void> {
    this.ensureReady();
    const jid = jidOf(chat);
    if (typing) await this.client.subscribePresence(this.connectionId, jid);
    await this.client.typing(this.connectionId, jid, typing === "recording" ? "recording" : typing ? "composing" : "paused");
  }

  async watchPresence(chat: ChatAddress): Promise<void> {
    this.ensureReady();
    await this.client.subscribePresence(this.connectionId, jidOf(chat));
  }

  async checkNumber(number: string): Promise<NumberCheck> {
    this.ensureReady();
    const digits = `${number}`.replace(/\D/g, "");
    const [result] = (await this.client.checkNumbers(this.connectionId, [digits])) || [];
    return result?.exists && result.jid ? { exists: true, jid: result.jid } : { exists: false };
  }

  async profilePictureUrl(chat: ChatAddress): Promise<string | null> {
    this.ensureReady();
    const jid = jidOf(chat);
    const url = await cachedProfilePicture(this.connectionId, jid, () => this.client.avatar(this.connectionId, jid));
    return url || null;
  }

  async groupParticipants(chat: ChatAddress): Promise<GroupParticipant[]> {
    return (await this.groupInfo(chat)).participants;
  }

  async groupInfo(chat: ChatAddress): Promise<GroupInfo> {
    this.ensureReady();
    const jid = chat.jid || jidOf({ ...chat, isGroup: true });
    // Mesmo cache de 10 min por conexão do Baileys (forgetGroup no group_update).
    const metadata = await getGroupMetadata<GatewayGroupInfo>(
      { id: this.connectionId, groupMetadata: (groupJid: string) => this.client.groupInfo(this.connectionId, groupJid) },
      jid
    );
    const created = metadata.createdAt ? new Date(metadata.createdAt) : null;
    return {
      subject: metadata.subject || "",
      description: metadata.description?.trim() || null,
      createdAt: created && !Number.isNaN(created.getTime()) ? created : null,
      participants: (metadata.participants || []).map(p => ({
        jid: p.jid,
        ...(p.lid ? { lid: p.lid } : {}),
        ...(p.phone ? { phone: p.phone } : {}),
        isAdmin: !!p.isAdmin,
        isMe: !!p.isMe
      }))
    };
  }
}

export default WhatsmeowChannel;
