import Whatsapp from "../models/Whatsapp";
import { getChannel, numberAddress } from "../channels";
import { contentFromFile } from "../channels/media";

export type MessageData = {
  number: number | string;
  body: string;
  mediaPath?: string;
  fileName?: string;
};

export const SendMessage = async (
  whatsapp: Whatsapp,
  messageData: MessageData
): Promise<any> => {
  try {
    const channel = getChannel(whatsapp.id);
    const to = await numberAddress(messageData.number, whatsapp.companyId);

    const content = messageData.mediaPath
      ? contentFromFile(messageData.fileName, messageData.mediaPath, messageData.body)
      : // U+200E marks messages the WhatsApp echo must not store again.
        { type: "text" as const, text: `\u200e ${messageData.body}` };

    const sent = await channel.send(to, content);
    return sent.raw;
  } catch (err: any) {
    throw new Error(err);
  }
};
