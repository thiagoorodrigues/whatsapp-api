import net from "net";
import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { logger } from "./utils/logger";
import { StartWhatsAppSessionsOnBoot } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import { TransferTicketQueue } from "./wbotTransferTicketQueue";
import cron from "node-cron";
import { resumeInterruptedIndexing } from "./services/AiAgentServices/knowledge/KnowledgeService";
import { flushLogs } from "./libs/systemLog";
import PurgeSystemLogsService from "./services/SystemLogServices/PurgeSystemLogsService";
import { isWhatsmeow, validateEngineConfig } from "./config/whatsappEngine";
import SessionService from "./services/WhatsmeowServices/SessionService";
import { purgeServerMetrics, recordServerMetrics } from "./services/ServerMonitorServices/metricsHistory";

// O fetch do Node tenta IPv6 e IPv4 em paralelo com só 250 ms por tentativa. Numa
// rede sem IPv6 e com IPv4 lento, nenhuma conecta (ViaCEP dava
// UND_ERR_CONNECT_TIMEOUT com o curl respondendo em 1 s). 1 s por tentativa resolve
// e não atrasa onde a rede está boa. (O @types/node do projeto ainda não tem a função.)
(net as any).setDefaultAutoSelectFamilyAttemptTimeout?.(1000);

// Without these the code would sign tokens with a public default secret.
const missing = ["JWT_SECRET", "JWT_REFRESH_SECRET"].filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// Motor inválido ou gateway sem URL/token: melhor não subir do que falhar no primeiro envio.
const engineError = validateEngineConfig();
if (engineError) {
  console.error(engineError);
  process.exit(1);
}

// Promessa sem catch: registra e segue (antes derrubava o processo).
process.on("unhandledRejection", reason => {
  logger.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, "unhandledRejection");
});
// Exceção sem tratamento: registra, grava (espera no máximo 3 s, para um banco
// travado não manter o processo quebrado vivo) e encerra (o container reinicia).
process.on("uncaughtException", err => {
  logger.error({ err }, "uncaughtException");
  Promise.race([flushLogs(), new Promise(resolve => setTimeout(resolve, 3000))]).finally(() => process.exit(1));
});

const server = app.listen(process.env.PORT, async () => {
  const companies = await Company.findAll();

  // Baileys: conexões de cada empresa; whatsmeow: consumer + health +
  // reconciliação com o gateway. As filas só depois.
  StartWhatsAppSessionsOnBoot(companies.map(c => c.id)).then(() => {
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

cron.schedule("30 3 * * *", async () => {
  try {
    const removed = await PurgeSystemLogsService();
    logger.info(`Logs do sistema: ${removed} registros antigos apagados`);
  } catch (error) {
    logger.error({ err: error }, "Limpeza dos logs do sistema falhou");
  }
});

cron.schedule("* * * * *", async () => {
  try {
    await recordServerMetrics();
  } catch (error) {
    logger.error({ err: error }, "Leitura do monitor do servidor falhou");
  }
});

cron.schedule("45 3 * * *", async () => {
  try {
    const removed = await purgeServerMetrics();
    logger.info(`Monitor do servidor: ${removed} leituras antigas apagadas`);
  } catch (error) {
    logger.error({ err: error }, "Limpeza do monitor do servidor falhou");
  }
});

initIO(server);
gracefulShutdown(server, {
  onShutdown: async () => {
    // Motor whatsmeow: para de ler os streams (espera os handlers em andamento) e o health.
    if (isWhatsmeow()) {
      await SessionService.shutdown().catch(err => logger.error({ err }, "Desligamento do consumer whatsmeow falhou"));
    }
    await flushLogs();
  }
});
