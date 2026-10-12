import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { gatewayConfig } from "../../config/whatsappEngine";
import { MAX_UPLOAD_BYTES } from "../../config/upload";
import { InboundMedia } from "../inbound";
import { MediaSource } from "../types";
import { GatewayClient } from "./client";

// Mídia de passagem entre a api e o gateway: pasta comum MEDIA_ROOT, com
// .gateway/out (api grava, gateway lê) e .gateway/in (gateway grava, api lê).

const OUT_DIR = path.join(".gateway", "out");
const IN_DIR = path.join(".gateway", "in");

export interface StagedMedia {
  /** Relativo à pasta de mídia, para o campo content.path do gateway. */
  path: string;
  /** Apaga a cópia em .gateway/out (nunca o original). */
  cleanup(): Promise<void>;
}

const URL_DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const URL_MAX_REDIRECTS = 5;

const safeExt = (ext: string): string => (/^\.[a-z0-9]{1,10}$/i.test(ext) ? ext : "");

const readSource = async (source: MediaSource): Promise<Buffer | string> => {
  if ("buffer" in source) return source.buffer;
  if ("path" in source) return source.path;
  // URL externa: sem timeout um servidor parado prenderia o envio para sempre.
  const res = await axios.get(source.url, {
    responseType: "arraybuffer",
    maxContentLength: MAX_UPLOAD_BYTES,
    maxBodyLength: MAX_UPLOAD_BYTES,
    timeout: URL_DOWNLOAD_TIMEOUT_MS,
    maxRedirects: URL_MAX_REDIRECTS
  });
  return Buffer.from(res.data);
};

/**
 * Coloca a mídia em MEDIA_ROOT/.gateway/out com nome único. Arquivos já
 * existentes (inclusive os de public/) são sempre copiados: só a cópia é
 * apagada depois do envio.
 */
export const stageOutgoing = async (
  source: MediaSource,
  ext: string
): Promise<StagedMedia> => {
  const { mediaRoot } = gatewayConfig();
  const outDir = path.join(mediaRoot, OUT_DIR);
  await fs.promises.mkdir(outDir, { recursive: true });
  const name = `${crypto.randomUUID()}${safeExt(ext)}`;
  const target = path.join(outDir, name);

  const data = await readSource(source);
  if (typeof data === "string") await fs.promises.copyFile(data, target);
  else await fs.promises.writeFile(target, data);

  return {
    path: path.posix.join(".gateway", "out", name),
    cleanup: () => fs.promises.rm(target, { force: true })
  };
};

/**
 * Pede ao gateway para baixar a mídia da mensagem, lê o arquivo gravado em
 * .gateway/in e o apaga (inclusive quando a leitura falha). Devolve null
 * quando o WhatsApp já não tem o arquivo.
 */
export const loadIncoming = async (
  client: Pick<GatewayClient, "downloadMedia">,
  connectionId: number,
  rawMessage: unknown
): Promise<InboundMedia | null> => {
  const downloaded = await client.downloadMedia(connectionId, rawMessage);
  if (!downloaded) return null;

  const { mediaRoot } = gatewayConfig();
  const inRoot = path.resolve(mediaRoot, IN_DIR);
  const file = path.resolve(mediaRoot, downloaded.path);
  // Defesa contra resposta ruim do gateway: só lê dentro de .gateway/in.
  if (path.isAbsolute(downloaded.path) || !file.startsWith(inRoot + path.sep)) {
    throw new Error("Caminho de mídia fora de .gateway/in");
  }

  try {
    const data = await fs.promises.readFile(file);
    return { data, mimetype: downloaded.mimetype, fileName: downloaded.fileName };
  } finally {
    await fs.promises.rm(file, { recursive: true, force: true });
  }
};
