import ListWhatsAppsService from "../WhatsappService/ListWhatsAppsService";
import { StartWhatsAppSession } from "./StartWhatsAppSession";
import * as Sentry from "@sentry/node";
import { isWhatsmeow } from "../../config/whatsappEngine";
import SessionService from "../WhatsmeowServices/SessionService";
import { logger } from "../../utils/logger";

export const StartAllWhatsAppsSessions = async (
  companyId: number
): Promise<void> => {
  try {
    // Motor whatsmeow: reconciliação com o estado do gateway (decisão 2).
    if (isWhatsmeow()) {
      await SessionService.reconcileCompany(companyId);
      return;
    }
    const whatsapps = await ListWhatsAppsService({ companyId });
    if (whatsapps.length > 0) {
      whatsapps.forEach(whatsapp => {
        StartWhatsAppSession(whatsapp, companyId);
      });
    }
  } catch (e) {
    Sentry.captureException(e);
  }
};

// Subida da api: Baileys sobe as conexões empresa por empresa (como sempre);
// whatsmeow liga o consumer e o health e reconcilia todas as conexões de uma
// vez com o gateway (um consumer só para todos os streams).
export const StartWhatsAppSessionsOnBoot = async (
  companyIds: number[]
): Promise<void> => {
  if (isWhatsmeow()) {
    try {
      await SessionService.reconcileOnBoot();
    } catch (e) {
      Sentry.captureException(e);
      logger.error(`whatsmeow: reconciliação do boot falhou: ${(e as Error)?.message || e}`);
    }
    return;
  }
  await Promise.all(companyIds.map(id => StartAllWhatsAppsSessions(id)));
};
