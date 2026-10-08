import QueueIntegrations from "../../models/QueueIntegrations";
import AppError from "../../errors/AppError";

// Only the company's own integration: another company's id is not found.
const DeleteQueueIntegrationService = async (id: string, companyId: number): Promise<void> => {
  const dialogflow = await QueueIntegrations.findOne({
    where: { id, companyId }
  });

  if (!dialogflow) {
    throw new AppError("ERR_NO_DIALOG_FOUND", 404);
  }

  await dialogflow.destroy();
};

export default DeleteQueueIntegrationService;