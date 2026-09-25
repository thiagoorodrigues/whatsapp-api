import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { logger } from "../utils/logger";

import AppError from "../errors/AppError";
import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import Message from "../models/Message";
import Queue from "../models/Queue";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import formatBody from "../helpers/Mustache";
import ListMessagesService from "../services/MessageServices/ListMessagesService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import DeleteWhatsAppMessage from "../services/WbotServices/DeleteWhatsAppMessage";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import CheckContactNumber from "../services/WbotServices/CheckNumber";
import CheckIsValidContact from "../services/WbotServices/CheckIsValidContact";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import Files from "../models/Files";
import FilesOptions from "../models/FilesOptions";
import path from "path";
import fs from "fs";
import Ticket from "../models/Ticket";
import { SendMessage } from "../helpers/SendMessage";
import CreateMensagemDisparoService from "../services/MessageServices/MensagensDisparosService";

type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
  number?: string;
  closeTicket?: true;
  codeFile?: string;
  isGroup?: boolean;
  isAddUser?: boolean;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;
  const queues: number[] = [];

  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    user.queues.forEach(queue => {
      queues.push(queue.id);
    });
  }

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId,
    companyId,
    queues
  });

  SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg }: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];
  const { companyId } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);

  SetTicketMessagesAsRead(ticket);

  if (medias) {
    await Promise.all(
      medias.map(async (media: Express.Multer.File, index) => {
        await SendWhatsAppMedia({ media, ticket, body: Array.isArray(body) ? body[index] : body });
      })
    );
  } else {
    const send = await SendWhatsAppMessage({ body, ticket, quotedMsg });
  }

  return res.send();
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { messageId } = req.params;
  const { companyId } = req.user;

  const message = await DeleteWhatsAppMessage(messageId);

  const io = getIO();
  io.to(message.ticketId.toString()).emit(`company-${companyId}-appMessage`, {
    action: "update",
    message
  });

  return res.send();
};

export const sendFila = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  try {
    const whatsapp = await Whatsapp.findOne({ where: { id: whatsappId, status: "CONNECTED" } });

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const contactData = {
      name: `${messageData.number}`,
      number: messageData.number,
      profilePicUrl: undefined,
      isGroup: false,
      companyId: whatsapp.companyId,
      whatsappId
    };

    const contact = await CreateOrUpdateContactService(contactData);

    if (medias) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number: messageData.number,
                body: messageData.body ? formatBody(messageData.body, contact) : media.originalname,
                caption: messageData.body ? formatBody(messageData.body, contact) : "",
                mediaPath: media.path,
                fileName: media.originalname
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {
      await SendMessage(whatsapp, { number: messageData.number, body: formatBody(messageData.body, contact), mediaPath: undefined });
    }
    //GRAVAR   NA TABELA NOVA
    await CreateMensagemDisparoService({ messageData: { numero: messageData.number, message: messageData.body } })

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {

    if (Object.keys(err).length === 0) {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send - message: ${err.message || ""}`);
    } else {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send - message: ${err.message || ""}`);
    }
  }
};

export const sendFileFila = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;

  const whatsapp = await Whatsapp.findOne({ where: { id: whatsappId, status: 'CONNECTED' } });

  try {
    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("Numero e obrigatorio!");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;
    const companyId = whatsapp.companyId;

    let number = numberToTest.replace(/\D/g, "");

    // if (!messageData.isGroup) {
    //   const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
    //   number = CheckValidNumber.jid.replace(/\D/g, "");
    // }


    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl: undefined,
      isGroup: messageData.isGroup ? true : false,
      companyId,
      extraInfo: [],
      whatsappId
    };

    const contact = await CreateOrUpdateContactService(contactData);


    if (messageData.codeFile) {
      const file = await Files.findOne({ where: { code: messageData.codeFile } })

      if (file && file.id) {
        const files = await FilesOptions.findAll({ where: { fileId: file.id } });
        const filesList = files.filter(item => item.path && fs.existsSync(path.resolve(`./public/fileList/${item.fileId}/`, item.path)));

        if (filesList.length > 0) {
          await Promise.all(
            filesList.map(async (media, i) => {
              if (media.path) {
                await req.app.get("queues").messageQueue.add("SendMessage",
                  {
                    whatsappId,
                    data: {
                      number,
                      body: filesList.length == (i + 1) ? formatBody(body, contact) : "",
                      caption: filesList.length == (i + 1) ? formatBody(body, contact) : "",
                      mediaPath: path.resolve(`./public/fileList/${media.fileId}/`, media.path),
                      fileName: media.name
                    }
                  },
                  { removeOnComplete: true, attempts: 3 }
                );
              }
            })
          );
        } else {
          await SendMessage(whatsapp, { number: messageData.number, body: formatBody(messageData.body, contact), mediaPath: undefined });
        }
      } else {
        await SendMessage(whatsapp, { number: messageData.number, body: formatBody(messageData.body, contact), mediaPath: undefined });
      }

    } else {
      await SendMessage(whatsapp, { number: messageData.number, body: formatBody(messageData.body, contact), mediaPath: undefined });
    }
    //GRAVAR   NA TABELA NOVA

    await CreateMensagemDisparoService({ messageData: { numero: messageData.number, message: messageData.body } })

    return res.send({ mensagem: "Mensagem enviada" });

  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send-file - message: ${err.message || ""}`);
    } else {
      throw new AppError(err.message);
    }

  }
};

export const send = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;

    const companyId = whatsapp.companyId;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);

    const number = CheckValidNumber.jid.replace(/\D/g, "");

    const profilePicUrl = await GetProfilePicUrl(
      number,
      companyId
    );

    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: false,
      companyId,
      whatsappId
    };

    const contact = await CreateOrUpdateContactService(contactData);
    const ticket = await FindOrCreateTicketService(contact, whatsapp.id!, 0, companyId);

    if (medias) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number,
                body: body ? formatBody(body, contact) : media.originalname,
                caption: body ? formatBody(body, contact) : "",
                mediaPath: media.path,
                fileName: media.originalname
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {

      await SendWhatsAppMessage({ body: formatBody(body, contact), ticket, closeTicket: true });
      // await ticket.update({ lastMessage: body });

    }

    // await UpdateTicketService({
    //   ticketId: ticket.id,
    //   ticketData: { status: "closed" },
    //   companyId
    // });

    //SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {

    if (Object.keys(err).length === 0) {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send - message: ${err.message || ""}`);
    } else {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send - message: ${err.message || ""}`);
    }
  }
};

export const sendFile = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;

  const whatsapp = await Whatsapp.findByPk(whatsappId);

  try {
    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;
    const companyId = whatsapp.companyId;

    let number = numberToTest.replace(/\D/g, "");

    if (!messageData.isGroup) {
      const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
      number = CheckValidNumber.jid.replace(/\D/g, "");
    }

    const profilePicUrl = `${process.env.FRONTEND_URL}/nopicture.png`;

    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: messageData.isGroup ? true : false,
      companyId,
      extraInfo: [],
      whatsappId
    };

    const contact = await CreateOrUpdateContactService(contactData);

    let ticket: Ticket;

    if (messageData.isGroup) {
      ticket = await FindOrCreateTicketService(contact, whatsapp.id, 0, companyId, contact);
    } else {
      ticket = await FindOrCreateTicketService(contact, whatsapp.id, 0, companyId);
    }

    if (messageData.codeFile) {
      const file = await Files.findOne({ where: { code: messageData.codeFile } })

      if (file && file.id) {
        const files = await FilesOptions.findAll({ where: { fileId: file.id } });
        const filesList = files.filter(item => item.path && fs.existsSync(path.resolve(`./public/fileList/${item.fileId}/`, item.path)));

        if (filesList.length > 0) {
          await Promise.all(
            filesList.map(async (media, i) => {
              if (media.path) {
                await req.app.get("queues").messageQueue.add("SendMessage",
                  {
                    whatsappId,
                    data: {
                      number,
                      body: filesList.length == (i + 1) ? formatBody(body, contact) : "",
                      caption: filesList.length == (i + 1) ? formatBody(body, contact) : "",
                      mediaPath: path.resolve(`./public/fileList/${media.fileId}/`, media.path),
                      fileName: media.name
                    }
                  },
                  { removeOnComplete: true, attempts: 3 }
                );
              }
            })
          );
        } else {

          await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });
          //await ticket.update({ lastMessage: body });

        }

      } else {
        await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });
        //await ticket.update({ lastMessage: body });
      }

    } else {
      await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });
      //await ticket.update({ lastMessage: body });
    }

    // await UpdateTicketService({
    //   ticketId: ticket.id,
    //   ticketData: { status: "closed" },
    //   companyId
    // });

    //SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });

  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send-file - message: ${err.message || ""}`);
    } else {
      throw new AppError(err.message);
    }

  }

  /*
  try {
   

    

    if (messageData.codeFile) {
      const file = await Files.findOne({ where: { code: messageData.codeFile } })

      if (file && file.id) {

        const files = await FilesOptions.findAll({ where: { fileId: file.id } });
        const filesList = files.filter(item => item.path && fs.existsSync(path.resolve(`./public/fileList/${item.fileId}/`, item.path)));

        if (filesList.length > 0) {
          await Promise.all(
            filesList.map(async (media, i) => {
              if (media.path) {
                await req.app.get("queues").messageQueue.add("SendMessage",
                  {
                    whatsappId,
                    data: {
                      number,
                      body: filesList.length == (i + 1) ? formatBody(body, contact) : "",
                      caption: filesList.length == (i + 1) ? formatBody(body, contact) : "",
                      mediaPath: path.resolve(`./public/fileList/${media.fileId}/`, media.path),
                      fileName: media.name
                    }
                  },
                  { removeOnComplete: true, attempts: 3 }
                );
              }
            })
          );
        } else {

          await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });
          await ticket.update({
            lastMessage: body,
          });

        }

      } else {

        await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });
        await ticket.update({
          lastMessage: body,
        });

      }

    } else {

      await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });
      await ticket.update({
        lastMessage: body,
      });

    }

    await UpdateTicketService({
      ticketId: ticket.id,
      ticketData: { status: "closed" },
      companyId
    });

    //SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });

  } catch (err: any) {

    if (Object.keys(err).length === 0) {
      throw new AppError(`Não foi possível enviar a mensagem, tente novamente em alguns instantes - service: send - message: ${err.message || ""}`);
    } else {
      throw new AppError(err.message);
    }

  }
  */
};

export const sendTeste = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;

    const companyId = whatsapp.companyId;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);

    const number = CheckValidNumber.jid.replace(/\D/g, "");

    const profilePicUrl = await GetProfilePicUrl(
      number,
      companyId
    );

    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: false,
      companyId,
      whatsappId
    };

    const contact = await CreateOrUpdateContactService(contactData);
    const ticket = await FindOrCreateTicketService(contact, whatsapp.id!, 0, companyId);

    await SendWhatsAppMessage({ body: formatBody(body, contact), ticket });

    await ticket.update({
      lastMessage: body,
    });

    await UpdateTicketService({
      ticketId: ticket.id,
      ticketData: { status: "closed" },
      companyId
    });

    return res.send({ mensagem: "Mensagem enviada" });

  } catch (err: any) {
    throw new AppError(err.message);
  }
}