import mime from "mime-types";
import { OutgoingContent } from "./types";

/** Message content for a file on disk (campaigns, API and scheduled sends). */
export const contentFromFile = (fileName: string, path: string, caption?: string): OutgoingContent => {
  const mimeType = mime.lookup(path);
  if (!mimeType) throw new Error("Invalid mimetype");
  const kind = mimeType.split("/")[0];
  if (kind === "video") return { type: "video", path, caption: caption || "", fileName };
  if (kind === "audio") return { type: "audio", path, mimetype: "audio/mp4", voice: true };
  if (kind === "document" || kind === "application") {
    return { type: "document", path, caption: caption || undefined, fileName, mimetype: mimeType };
  }
  return { type: "image", path, caption: caption || undefined };
};

/**
 * Message content for an upload. Audio must already be converted (see
 * SendWhatsAppMedia).
 */
export const contentFromUpload = (
  file: { buffer: Buffer; mimetype: string; originalname: string },
  caption?: string
): OutgoingContent => {
  const kind = file.mimetype.split("/")[0];
  if (kind === "video") return { type: "video", buffer: file.buffer, caption, fileName: file.originalname };
  if (kind === "audio") return { type: "audio", buffer: file.buffer, mimetype: "audio/mp4", voice: true };
  if (kind === "document" || kind === "text" || kind === "application") {
    return { type: "document", buffer: file.buffer, caption, fileName: file.originalname, mimetype: file.mimetype };
  }
  return { type: "image", buffer: file.buffer, caption };
};
