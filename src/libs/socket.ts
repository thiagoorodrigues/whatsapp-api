import { Server as SocketIO, Socket } from "socket.io";
import { Server } from "http";
import { verify } from "jsonwebtoken";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import authConfig from "../config/auth";
import User from "../models/User";
import Ticket from "../models/Ticket";
import Contact from "../models/Contact";
import {
  companyRoom,
  isTicketStatus,
  notificationRoom,
  statusRoom,
  ticketRoom
} from "./socketRooms";

let io: SocketIO;

export interface SocketUser {
  id: number;
  companyId: number;
  profile: string;
}

// Reads the access token sent by the client in the handshake (auth.token).
export const authenticateSocket = (token: unknown): SocketUser | null => {
  if (typeof token !== "string" || !token) return null;
  try {
    const { id, companyId, profile } = verify(token, authConfig.secret, {
      algorithms: ["HS256"]
    }) as any;
    if (!id || !companyId) return null;
    return { id: Number(id), companyId: Number(companyId), profile };
  } catch {
    return null;
  }
};

const userOf = (socket: Socket): SocketUser => (socket as any).user;

export const initIO = (httpServer: Server): SocketIO => {
  io = new SocketIO(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL
    }
  });

  io.use((socket, next) => {
    const user = authenticateSocket((socket.handshake as any).auth?.token);
    if (!user) return next(new Error("ERR_SESSION_EXPIRED"));
    (socket as any).user = user;
    return next();
  });

  // Handlers are attached before any await: clients ask to join rooms right
  // after connecting, and an event that arrives before its handler is lost.
  io.on("connection", async socket => {
    const { id, companyId } = userOf(socket);
    logger.info("Client Connected");
    socket.join(companyRoom(companyId));

    socket.on("joinChatBox", async (ticketId: string) => {
      const ticket = await Ticket.findOne({
        where: { id: Number(ticketId) || 0, companyId },
        attributes: ["id", "isGroup", "status", "whatsappId"],
        include: [{ model: Contact, as: "contact", attributes: ["number", "lid"] }]
      });
      if (!ticket) return;
      socket.join(ticketRoom(companyId, ticket.id));
      // So the contact's "digitando..." reaches this conversation. Loaded on
      // demand: the service needs the WhatsApp channel, which needs this file.
      import("../services/TicketServices/ContactTypingService")
        .then(({ watchTicketPresence }) => watchTicketPresence(ticket))
        .catch(err => logger.debug(`watchTicketPresence: ${err}`));
    });

    socket.on("joinNotification", () => {
      socket.join(notificationRoom(companyId));
    });

    socket.on("joinTickets", (status: string) => {
      if (isTicketStatus(status)) socket.join(statusRoom(companyId, status));
    });

    const user = await User.findOne({ where: { id, companyId } });
    if (user && !user.online) {
      user.online = true;
      await user.save();
    }
  });
  return io;
};

export const getIO = (): SocketIO => {
  if (!io) {
    throw new AppError("Socket IO not initialized");
  }
  return io;
};
