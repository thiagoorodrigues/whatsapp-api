import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import { TransferTicketQueue } from "./wbotTransferTicketQueue";
import cron from "node-cron";
import { resumeInterruptedIndexing } from "./services/AiAgentServices/knowledge/KnowledgeService";

// Without these the code would sign tokens with a public default secret.
const missing = ["JWT_SECRET", "JWT_REFRESH_SECRET"].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const server = app.listen(process.env.PORT, async () => {
  const companies = await Company.findAll();
  const allPromises: any[] = [];

  companies.map(async c => {
    const promise = StartAllWhatsAppsSessions(c.id);
    allPromises.push(promise);
  });

  Promise.all(allPromises).then(() => {
    startQueueProcess();
  });

  // Knowledge documents a restart left half-indexed.
  resumeInterruptedIndexing().catch(err => logger.error(`Knowledge indexing resume failed: ${err}`));

  logger.info(`Server started on port: ${process.env.PORT}`);
});

cron.schedule("* * * * *", async () => {
  try {
    logger.info(`Serviço de transferencia de tickets iniciado`);
    await TransferTicketQueue();
  }
  catch (error) {
    logger.error(error);
  }
});

initIO(server);
gracefulShutdown(server);
