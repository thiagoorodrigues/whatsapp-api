import { Request, Response } from "express";
import { getWbot } from "../libs/wbot";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { clearBaileysKeys } from "../models/BaileysKey";
import { requestContext } from "../libs/requestContext";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import { isWhatsmeow } from "../config/whatsappEngine";
import SessionService from "../services/WhatsmeowServices/SessionService";

const store = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  if (isWhatsmeow()) {
    await requestContext.exit(() => SessionService.start(whatsapp));
  } else {
    await requestContext.exit(() => StartWhatsAppSession(whatsapp, companyId));
  }

  return res.status(200).json({ message: "Starting session." });
};

const update = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  // Only the session is reset. UpdateWhatsAppService fills every field left
  // out with its default, which wiped the queues and the history import.
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  // Motor whatsmeow: desparelha no gateway e pede QR novo; session e
  // BaileysKeys ficam intactos (a volta para o Baileys depende deles).
  if (isWhatsmeow()) {
    await requestContext.exit(() => SessionService.restart(whatsapp));
    return res.status(200).json({ message: "Starting session." });
  }
  await whatsapp.update({ session: "" });
  await clearBaileysKeys(whatsapp.id);

  await requestContext.exit(() => StartWhatsAppSession(whatsapp, companyId));

  return res.status(200).json({ message: "Starting session." });
};

const remove = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

  // Motor whatsmeow: session fica vazia, então não serve de condição.
  if (isWhatsmeow()) {
    await SessionService.logout(whatsapp);
    return res.status(200).json({ message: "Session disconnected." });
  }

  if (whatsapp.session) {
    await whatsapp.update({ status: "DISCONNECTED", session: "" });
    await clearBaileysKeys(whatsapp.id);
    const wbot = getWbot(whatsapp.id);
    await wbot.logout();
  }

  return res.status(200).json({ message: "Session disconnected." });
};

export default { store, remove, update };
