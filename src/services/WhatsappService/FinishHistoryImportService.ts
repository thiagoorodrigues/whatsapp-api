import { getIO } from "../../libs/socket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import ShowWhatsAppService from "./ShowWhatsAppService";

// Switches "Importar mensagens" off once the history import is over, so a
// later connection of the same number does not import again.
const FinishHistoryImportService = async (whatsappId: number, companyId: number): Promise<void> => {
  const [updated] = await Whatsapp.update(
    { importMessages: false },
    { where: { id: whatsappId, companyId, importMessages: true } }
  );
  if (!updated) return;

  logger.info(`Importação de mensagens da conexão ${whatsappId} concluída; opção desligada`);
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  getIO().emit(`company-${companyId}-whatsapp`, { action: "update", whatsapp });
};

export default FinishHistoryImportService;
