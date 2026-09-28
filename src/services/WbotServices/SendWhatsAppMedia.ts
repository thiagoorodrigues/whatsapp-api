import { WAMessage } from "@whiskeysockets/baileys";
import * as Sentry from "@sentry/node";
import fs from "fs";
import { exec } from "child_process";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import AppError from "../../errors/AppError";
import { getTicketChannel, ticketAddress } from "../../channels";
import { contentFromUpload } from "../../channels/media";
import Ticket from "../../models/Ticket";
import formatBody from "../../helpers/Mustache";
import { logger } from "../../utils/logger";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

const processeFileAudio = async (inputBuffer: Express.Multer.File, mimetype: string, type = true): Promise<Buffer> => {
  const mime = mimetype.split('/');
  const outputAudio = `${publicFolder}/output-${new Date().getTime()}.mp3`;
  const inputPath = `${publicFolder}/${new Date().getTime()}.${mime[1]}`;

  fs.writeFileSync(inputPath, inputBuffer.buffer);

  logger.info(inputPath)
  logger.info(outputAudio)  

  if (type) {    
    return new Promise((resolve, reject) => {
      exec(
        `${ffmpegPath.path} -i ${inputPath} -vn -ab 128k -ar 44100 -f ipod ${outputAudio} -y`,
        (error, _stdout, _stderr) => {
          if (error) reject(error);
          const outputFile = fs.readFileSync(outputAudio);
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputAudio);
          resolve(outputFile);
        }
      );
    });
  } else {    
    return new Promise((resolve, reject) => {
      exec(
        `${ffmpegPath.path} -i ${inputPath} -vn -ar 44100 -ac 1 -b:a 192k -f ipod ${outputAudio} -y`,
        (error, _stdout, _stderr) => {
          if (error) reject(error);
          const outputFile = fs.readFileSync(outputAudio);
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputAudio);
          resolve(outputFile);
        }
      );
    });
  }
}

const processAudio = async (audio: string): Promise<string> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ab 128k -ar 44100 -f ipod ${outputAudio} -y`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};

const processAudioFile = async (audio: string): Promise<string> => {
  const outputAudio = `${publicFolder}/${new Date().getTime()}.mp3`;
  return new Promise((resolve, reject) => {
    exec(
      `${ffmpegPath.path} -i ${audio} -vn -ar 44100 -ac 2 -b:a 192k ${outputAudio}`,
      (error, _stdout, _stderr) => {
        if (error) reject(error);
        fs.unlinkSync(audio);
        resolve(outputAudio);
      }
    );
  });
};

const SendWhatsAppMedia = async ({ media, ticket, body }: Request): Promise<WAMessage> => {
  try {
    const channel = await getTicketChannel(ticket);
    const bodyMessage = formatBody(body, ticket.contact);
    const isAudio = media.mimetype.split("/")[0] === "audio";
    // Voice notes go out as mp4 audio.
    const file = isAudio
      ? { ...media, buffer: await processeFileAudio(media, media.mimetype, false) }
      : media;

    const sent = await channel.send(ticketAddress(ticket), contentFromUpload(file, isAudio ? undefined : bodyMessage));

    await ticket.update({ lastMessage: bodyMessage });
    return sent.raw;

  } catch (err) {
    Sentry.captureException(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;
