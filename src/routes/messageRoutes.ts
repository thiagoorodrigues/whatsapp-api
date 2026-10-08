import { Router } from "express";
import { memoryUpload } from "../config/upload";

import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";
import tokenAuth from "../middleware/tokenAuth";

import * as MessageController from "../controllers/MessageController";

const messageRoutes = Router();

const upload = multer(uploadConfig);

messageRoutes.get("/messages/:ticketId", isAuth, MessageController.index);
messageRoutes.post("/messages/:ticketId/read", isAuth, MessageController.markRead);
messageRoutes.post("/messages/:ticketId/typing", isAuth, MessageController.typing);
messageRoutes.post("/messages/:ticketId", isAuth, memoryUpload.array("medias"), MessageController.store);
messageRoutes.post("/messages/:messageId/forward", isAuth, MessageController.forward);
messageRoutes.post("/messages/:messageId/react", isAuth, MessageController.react);
messageRoutes.delete("/messages/:messageId", isAuth, MessageController.remove);
messageRoutes.post("/api/messages/send", tokenAuth, upload.array("medias"), MessageController.sendFila);
messageRoutes.post("/api/messages/send-fila", tokenAuth, MessageController.sendFila);


export default messageRoutes;
