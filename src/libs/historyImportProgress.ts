import { getIO } from "./socket";
import { companyRoom } from "./socketRooms";
import { ImportProgress } from "../services/WbotServices/historyImport";

// Latest history import progress per connection, kept in memory so the
// connection card can show it after a page reload.
const store = new Map<number, { companyId: number; progress: ImportProgress }>();

export const publishImportProgress = (whatsappId: number, companyId: number, progress: ImportProgress): void => {
  store.set(whatsappId, { companyId, progress });
  getIO()
    .to(companyRoom(companyId))
    .emit(`company-${companyId}-whatsapp`, { action: "importProgress", whatsappId, progress });
};

export const getImportProgress = (whatsappId: number, companyId: number): ImportProgress | null => {
  const entry = store.get(whatsappId);
  return entry && entry.companyId === companyId ? entry.progress : null;
};
