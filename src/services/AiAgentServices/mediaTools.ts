import crypto from "crypto";
import fs from "fs";
import path from "path";
import uploadConfig from "../../config/upload";
import { OutgoingContent } from "../../channels/types";

// Files an agent can send ("Enviar mídia"). They live in
// public/company{id}/ai-agents/{agentId}/{id}{ext}; the path is always
// rebuilt from the id, never taken from the client.

export interface AgentMediaFile {
  id: string;
  ext: string;
  // What the agent calls it and when it should send it.
  name: string;
  description: string;
  caption: string;
  fileName: string;
  mimetype: string;
  size: number;
}

export interface MediaToolConfig {
  enabled: boolean;
  files: AgentMediaFile[];
}

export const MAX_MEDIA_FILES = 10;
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_PER_REPLY = 3;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXT = /^\.[a-z0-9]{1,8}$/;

export const sanitizeMediaTool = (input: any, previous?: MediaToolConfig): MediaToolConfig => {
  const names = new Set<string>();
  const files = (Array.isArray(input?.files) ? input.files : [])
    .map((f: any): AgentMediaFile | null => {
      const id = String(f?.id || "");
      const ext = String(f?.ext || "").toLowerCase();
      const name = String(f?.name || "").trim().slice(0, 80);
      if (!ID.test(id) || !EXT.test(ext) || !name || names.has(name.toLowerCase())) return null;
      names.add(name.toLowerCase());
      const before = previous?.files?.find(p => p.id === id);
      return {
        id,
        ext,
        name,
        description: String(f?.description || "").trim().slice(0, 500),
        caption: String(f?.caption || "").trim().slice(0, 1000),
        fileName: String(before?.fileName || f?.fileName || `${name}${ext}`).slice(0, 200),
        mimetype: String(before?.mimetype || f?.mimetype || "application/octet-stream").slice(0, 100),
        size: Number(before?.size || f?.size) || 0
      };
    })
    .filter(Boolean)
    .slice(0, MAX_MEDIA_FILES) as AgentMediaFile[];
  return { enabled: !!input?.enabled && files.length > 0, files };
};

const agentFolder = (companyId: number, agentId: number) =>
  path.join(uploadConfig.directory, `company${companyId}`, "ai-agents", String(agentId));

export const mediaPath = (companyId: number, agentId: number, file: Pick<AgentMediaFile, "id" | "ext">) => {
  if (!ID.test(file.id) || !EXT.test(file.ext)) throw new Error("arquivo inválido");
  return path.join(agentFolder(companyId, agentId), `${file.id}${file.ext}`);
};

// GIFs go as documents: as an image WhatsApp would show only the first frame.
export const kindOf = (mimetype: string): "image" | "video" | "audio" | "document" => {
  if (/^image\/(jpeg|png|webp)$/.test(mimetype)) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "audio";
  return "document";
};

export const contentFor = (file: AgentMediaFile, filePath: string): OutgoingContent => {
  const caption = file.caption || undefined;
  switch (kindOf(file.mimetype)) {
    case "image":
      return { type: "image", path: filePath, ...(caption ? { caption } : {}) };
    case "video":
      return { type: "video", path: filePath, fileName: file.fileName, ...(caption ? { caption } : {}) };
    case "audio":
      return { type: "audio", path: filePath, mimetype: file.mimetype };
    default:
      return { type: "document", path: filePath, caption, fileName: file.fileName, mimetype: file.mimetype };
  }
};

/** Saves an uploaded file in the agent's folder. */
export const saveAgentMedia = async (
  companyId: number,
  agentId: number,
  upload: { originalname: string; mimetype: string; size: number; buffer: Buffer }
): Promise<AgentMediaFile> => {
  const original = path.basename(upload.originalname || "arquivo");
  const rawExt = path.extname(original).toLowerCase();
  const ext = EXT.test(rawExt) ? rawExt : ".bin";
  const file: AgentMediaFile = {
    id: crypto.randomUUID(),
    ext,
    name: original.slice(0, original.length - path.extname(original).length).trim().slice(0, 80) || "Arquivo",
    description: "",
    caption: "",
    fileName: original.slice(0, 200),
    mimetype: upload.mimetype || "application/octet-stream",
    size: upload.size
  };
  await fs.promises.mkdir(agentFolder(companyId, agentId), { recursive: true });
  await fs.promises.writeFile(mediaPath(companyId, agentId, file), upload.buffer);
  return file;
};

/** Deletes the files that were in `before` and are no longer in `after`. */
export const removeOrphanMedia = async (
  companyId: number,
  agentId: number,
  before: AgentMediaFile[] = [],
  after: AgentMediaFile[] = []
) => {
  const kept = new Set(after.map(f => f.id));
  await Promise.all(
    before
      .filter(f => !kept.has(f.id))
      .map(f => fs.promises.rm(mediaPath(companyId, agentId, f), { force: true }).catch(() => undefined))
  );
};
