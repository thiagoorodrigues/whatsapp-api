import fs from "fs";
import path from "path";
import mime from "mime-types";
import * as Sentry from "@sentry/node";
import uploadConfig from "../../config/upload";
import { MAX_UPLOAD_BYTES } from "../../config/upload";
import { getTicketChannel, OutgoingContent, SendOptions, ticketAddress } from "../../channels";
import { publicFileUrl } from "../../helpers/mediaStorage";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { publicFetch } from "../AiAgentServices/httpTools";
import SaveSentMessageService, { SentMedia } from "./SaveSentMessageService";

type MediaContent = Exclude<OutgoingContent, { type: "text" }>;

const DEFAULT_MIME: Record<MediaContent["type"], string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mp4",
  document: "application/octet-stream"
};

// Files under our own /public are read from disk (the public-host check
// would refuse our own address).
const localPublicPath = (url: string): string | null => {
  const base = publicFileUrl("");
  if (!url.startsWith(base)) return null;
  const relative = decodeURIComponent(url.slice(base.length).split("?")[0]);
  const full = path.resolve(uploadConfig.directory, relative);
  return full.startsWith(path.resolve(uploadConfig.directory) + path.sep) ? full : null;
};

const fileNameOf = (content: MediaContent): string => {
  if ("fileName" in content && content.fileName) return content.fileName;
  const source = "path" in content ? content.path : "url" in content ? content.url : "";
  return decodeURIComponent(path.basename((source || "").split("?")[0])) || "";
};

const download = async (url: string): Promise<{ buffer: Buffer; mimetype?: string }> => {
  const local = localPublicPath(url);
  if (local) return { buffer: await fs.promises.readFile(local) };
  const response = await publicFetch(url, {}, 30_000);
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const size = Number(response.headers.get("content-length") || 0);
  if (size > MAX_UPLOAD_BYTES) throw new Error("file too large");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error("file too large");
  return { buffer, mimetype: String(response.headers.get("content-type") || "").split(";")[0] || undefined };
};

/**
 * Media to send and save: files by URL are fetched first, so what is saved
 * is what went out. When the fetch fails the URL is sent as is (WhatsApp
 * fetches it) and the message is saved without the file.
 */
const prepareMedia = async (content: MediaContent): Promise<{ content: OutgoingContent; media?: SentMedia }> => {
  const fileName = fileNameOf(content);
  const declared = "mimetype" in content ? content.mimetype : undefined;
  const guess = () => declared || (fileName && mime.lookup(fileName)) || DEFAULT_MIME[content.type];
  try {
    if ("buffer" in content) return { content, media: { buffer: content.buffer, mimetype: guess(), fileName } };
    if ("path" in content) {
      const { path: filePath, ...rest } = content;
      const buffer = await fs.promises.readFile(filePath);
      return { content: { ...rest, buffer } as MediaContent, media: { buffer, mimetype: guess(), fileName } };
    }
    const { url, ...rest } = content;
    const { buffer, mimetype } = await download(url);
    return {
      content: { ...rest, buffer } as MediaContent,
      media: { buffer, mimetype: declared || mimetype || guess(), fileName }
    };
  } catch (err) {
    logger.warn(`Could not read media ${fileName || ""} to save it: ${err}`);
    return { content };
  }
};

const bodyOf = (content: OutgoingContent, media?: SentMedia): string | undefined => {
  if (content.type === "text") return content.text;
  if ("caption" in content && content.caption) return content.caption;
  return media?.fileName || undefined;
};

/**
 * Sends a message to a ticket's contact through its channel and saves it in
 * the ticket (the WhatsApp echo of platform messages is ignored).
 */
const SendTicketMessageService = async (
  ticket: Ticket,
  content: OutgoingContent,
  options: SendOptions & { quotedMsgId?: string; followUpEnrollmentId?: number } = {}
): Promise<Message> => {
  const channel = await getTicketChannel(ticket);
  const prepared = content.type === "text" ? { content } : await prepareMedia(content);
  const { quotedMsgId, followUpEnrollmentId, ...sendOptions } = options;

  const sent = await channel.send(ticketAddress(ticket), prepared.content, sendOptions);

  try {
    return await SaveSentMessageService({
      ticket,
      sent,
      body: bodyOf(content, prepared.media),
      media: prepared.media,
      quotedMsgId,
      followUpEnrollmentId
    });
  } catch (err) {
    // Sent but not saved: log, the customer already has it.
    Sentry.captureException(err);
    logger.error(`Message sent to ticket ${ticket.id} but not saved: ${err}`);
    return null;
  }
};

export default SendTicketMessageService;
