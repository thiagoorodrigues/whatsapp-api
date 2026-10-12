import path from "path";
import uploadConfig from "./upload";

export type WhatsappEngine = "baileys" | "whatsmeow";

export interface GatewayConfig {
  url: string;
  token: string;
  mediaRoot: string;
}

// Motor do WhatsApp: "baileys" (padrão) ou "whatsmeow" (gateway em Go).
// Qualquer outro valor é erro de configuração: a api não deve subir.
export const engine = (): WhatsappEngine => {
  const raw = (process.env.WHATSAPP_ENGINE || "").trim();
  if (!raw) return "baileys";
  if (raw === "baileys" || raw === "whatsmeow") return raw;
  throw new Error(
    `WHATSAPP_ENGINE inválido: "${raw}" (use "baileys" ou "whatsmeow")`
  );
};

export const isWhatsmeow = (): boolean => engine() === "whatsmeow";

// Com whatsmeow, GATEWAY_URL e GATEWAY_TOKEN são obrigatórios; a pasta de
// mídia compartilhada com o gateway é a pasta de uploads, salvo
// GATEWAY_MEDIA_ROOT. Com baileys, nada disso é exigido.
export const gatewayConfig = (): GatewayConfig => {
  const url = (process.env.GATEWAY_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.GATEWAY_TOKEN || "").trim();
  if (isWhatsmeow()) {
    const missing = [
      !url && "GATEWAY_URL",
      !token && "GATEWAY_TOKEN"
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Com WHATSAPP_ENGINE=whatsmeow faltam as variáveis: ${missing.join(
          ", "
        )}`
      );
    }
  }
  const root = (process.env.GATEWAY_MEDIA_ROOT || "").trim();
  return {
    url,
    token,
    mediaRoot: root ? path.resolve(root) : uploadConfig.directory
  };
};

// Usada na subida (server.ts): devolve a mensagem de erro, ou null se válido.
export const validateEngineConfig = (): string | null => {
  try {
    gatewayConfig();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
};
