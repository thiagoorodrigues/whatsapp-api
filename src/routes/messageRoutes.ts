import { Router } from "express";
import { uploadMulterAWS } from "../config/uploadAws";

import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";
import tokenAuth from "../middleware/tokenAuth";

import * as MessageController from "../controllers/MessageController";

const messageRoutes = Router();

const upload = multer(uploadConfig);

messageRoutes.get("/messages/:ticketId", isAuth, MessageController.index);
messageRoutes.post("/messages/:ticketId", isAuth, uploadMulterAWS.array("medias"), MessageController.store);
messageRoutes.delete("/messages/:messageId", isAuth, MessageController.remove);
messageRoutes.post("/api/messages/send", tokenAuth, upload.array("medias"), MessageController.sendFila);
messageRoutes.post("/api/messages/send-fila", tokenAuth, MessageController.sendFila);


export default messageRoutes;
