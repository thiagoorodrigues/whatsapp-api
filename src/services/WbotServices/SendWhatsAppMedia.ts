import * as Sentry from "@sentry/node";
import fs from "fs";
import path from "path";
import convertToVoiceNote from "../../helpers/convertToVoiceNote";
import AppError from "../../errors/AppError";
import { getTicketChannel, ticketAddress } from "../../channels";
import { contentFromUpload } from "../../channels/media";
import Message from "../../models/Message";
import SaveSentMessageService from "../MessageServices/SaveSentMessageService";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";
import { logger } from "../../utils/logger";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
}

const SendWhatsAppMedia = async ({ media, ticket, body }: Request): Promise<Message> => {
  try {
    const channel = await getTicketChannel(ticket);
    const bodyMessage = formatBody(body, ticket.contact);
    const isAudio = media.mimetype.split("/")[0] === "audio";
    // Voice notes go out as mp4 audio.
    const file = isAudio
      ? { ...media, buffer: await convertToVoiceNote(media.buffer) }
      : media;

    const caption = isAudio ? undefined : bodyMessage;
    const sent = await channel.send(ticketAddress(ticket), contentFromUpload(file, caption));

    return SaveSentMessageService({
      ticket,
      sent,
      body: caption,
      media: { buffer: file.buffer, mimetype: isAudio ? "audio/mp4" : media.mimetype, fileName: media.originalname }
    });

  } catch (err) {
    Sentry.captureException(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;
