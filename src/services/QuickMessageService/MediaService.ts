import fs from "fs";
import path from "path";
import AppError from "../../errors/AppError";
import QuickMessage from "../../models/QuickMessage";
import uploadConfig from "../../config/upload";
import { safeName } from "../../helpers/mediaStorage";

// Anexo da resposta rápida: public/quickMessage/company{id}/<nome aleatório>.
// O Model guarda o caminho relativo a public/quickMessage.
const baseFolder = path.join(uploadConfig.directory, "quickMessage");

export const MAX_QUICK_MESSAGE_MEDIA_BYTES = 16 * 1024 * 1024;

export const findCompanyQuickMessage = async (id: string | number, companyId: number): Promise<QuickMessage> => {
  const record = await QuickMessage.findOne({ where: { id, companyId } });
  if (!record) throw new AppError("ERR_NO_QUICKMESSAGE_FOUND", 404);
  return record;
};

// Só apaga arquivo dentro de public/quickMessage (anexos antigos ficavam soltos ali).
const removeFile = async (relative: string | null): Promise<void> => {
  if (!relative) return;
  const full = path.resolve(baseFolder, relative);
  if (!full.startsWith(baseFolder + path.sep)) return;
  await fs.promises.unlink(full).catch(() => undefined);
};

export const saveQuickMessageMedia = async (
  record: QuickMessage,
  file: { buffer: Buffer; originalname: string; mimetype?: string; size: number }
): Promise<QuickMessage> => {
  if (!file?.buffer?.length) throw new AppError("ERR_QUICKMESSAGE_MEDIA_REQUIRED", 400);
  if (file.size > MAX_QUICK_MESSAGE_MEDIA_BYTES) throw new AppError("ERR_QUICKMESSAGE_MEDIA_TOO_BIG", 400);
  const folder = path.join(baseFolder, `company${record.companyId}`);
  await fs.promises.mkdir(folder, { recursive: true });
  const name = safeName(file.originalname || "arquivo", file.mimetype);
  await fs.promises.writeFile(path.join(folder, name), file.buffer);
  await removeFile(record.getDataValue("mediaPath"));
  await record.update({ mediaPath: `company${record.companyId}/${name}`, mediaName: file.originalname.slice(0, 200) });
  return record;
};

export const removeQuickMessageMedia = async (record: QuickMessage): Promise<QuickMessage> => {
  await removeFile(record.getDataValue("mediaPath"));
  await record.update({ mediaPath: null, mediaName: null });
  return record;
};
