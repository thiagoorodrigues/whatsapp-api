import crypto from "crypto";

// AES-256-GCM for secrets stored in the database (AI provider keys).
// Key: SECRETS_KEY (any string; hashed to 32 bytes). Falls back to
// JWT_SECRET so existing installs work, but a dedicated key is safer:
// rotating JWT_SECRET would make stored secrets unreadable.
const key = (): Buffer => {
  const source = process.env.SECRETS_KEY || process.env.JWT_SECRET;
  if (!source) throw new Error("SECRETS_KEY (or JWT_SECRET) must be set to store secrets");
  return crypto.createHash("sha256").update(source).digest();
};

const VERSION = "v1";

export const encryptSecret = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
};

export const decryptSecret = (payload: string): string => {
  const [version, iv, tag, data] = (payload || "").split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Invalid secret payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

// "sk-...abcd" -> "…abcd", safe to show in the UI.
export const secretHint = (plain: string): string => `…${plain.slice(-4)}`;
