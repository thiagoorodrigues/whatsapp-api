import crypto from "crypto";
import fs from "fs";
import path from "path";
import uploadConfig from "../config/upload";

// Message media is kept on the server, one folder per company
// (public/company{id}/), served under /public.

export const companyFolder = (companyId: number): string =>
  path.join(uploadConfig.directory, `company${companyId}`);

const safeName = (fileName: string, mimetype?: string): string => {
  const ext = path.extname(fileName) || (mimetype ? `.${mimetype.split("/")[1]?.split(";")[0] || "bin"}` : "");
  const base = path
    .basename(fileName, path.extname(fileName))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 80);
  // Random part: files under /public are reachable by URL, so names must
  // not be guessable.
  const unique = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  return `${unique}${base ? `_${base}` : ""}${ext.replace(/[^\w.]/g, "").slice(0, 12)}`;
};

/**
 * Saves a file in the company's folder. Returns the path stored in
 * Message.mediaUrl (e.g. "company1/1727470000_ab12cd_boleto.pdf").
 */
export const saveCompanyMedia = async (
  companyId: number,
  data: Buffer,
  fileName: string,
  mimetype?: string
): Promise<string> => {
  const folder = companyFolder(companyId);
  await fs.promises.mkdir(folder, { recursive: true });
  const name = safeName(fileName || "arquivo", mimetype);
  await fs.promises.writeFile(path.join(folder, name), data);
  return `company${companyId}/${name}`;
};

/**
 * Public URL of a file under /public. BACKEND_URL may already carry the
 * port; PROXY_PORT is only added when it doesn't.
 */
export const publicFileUrl = (relativePath: string): string => {
  const base = String(process.env.BACKEND_URL || "").replace(/\/+$/, "");
  let origin = base;
  try {
    const url = new URL(base);
    if (!url.port && process.env.PROXY_PORT && !["80", "443"].includes(process.env.PROXY_PORT)) {
      url.port = process.env.PROXY_PORT;
    }
    origin = url.toString().replace(/\/+$/, "");
  } catch (e) {
    // keep BACKEND_URL as is
  }
  return `${origin}/public/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
};
