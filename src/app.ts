import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import "./database";
import uploadConfig from "./config/upload";
import routes from "./routes";
import docsRoutes from "./routes/docsRoutes";
import statusRoutes from "./routes/statusRoutes";
import requestLog from "./middleware/requestLog";
import errorHandler from "./middleware/errorHandler";
import { messageQueue, sendScheduledMessages } from "./queues";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

app.set("queues", {
  messageQueue,
  sendScheduledMessages
});

app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL
  })
);
app.use(cookieParser());
app.use(requestLog);
//app.use(express.json());
app.use(express.json({ limit: '10mb' }));
app.use(Sentry.Handlers.requestHandler());
app.use("/public", express.static(uploadConfig.directory));
app.use(statusRoutes);
app.use(docsRoutes);
app.use(routes);

app.use(Sentry.Handlers.errorHandler());

app.use(errorHandler);

export default app;
