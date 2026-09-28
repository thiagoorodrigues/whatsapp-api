import axios, { AxiosRequestConfig } from "axios";
import Ticket from "../../models/Ticket";
import QueueIntegrations from "../../models/QueueIntegrations";
import { sleep as delay } from "../../helpers/botUtils";
import { InboundMessage } from "../../channels/inbound";
import { logger } from "../../utils/logger";
import { isNil } from "lodash";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import SendTicketMessageService from "../MessageServices/SendTicketMessageService";
import { getTicketChannel, OutgoingContent, ticketAddress } from "../../channels";


interface Request {
    inbound: InboundMessage;
    ticket: Ticket;
    typebot: QueueIntegrations;
}


const typebotListener = async ({
    inbound,
    ticket,
    typebot
}: Request): Promise<void> => {


    // Replies go through the ticket's channel and are saved in the ticket.
    const reply = (content: OutgoingContent) => SendTicketMessageService(ticket, content);
    const typing = async () => {
        try {
            const channel = await getTicketChannel(ticket);
            await channel.sendTyping(ticketAddress(ticket), true);
            await delay(typebotDelayMessage);
            await channel.sendTyping(ticketAddress(ticket), false);
        } catch (err) {
            logger.warn(`Typebot typing indicator failed: ${err}`);
        }
    };

    const { urlN8N: url,
        typebotExpires,
        typebotKeywordFinish,
        typebotKeywordRestart,
        typebotUnknownMessage,
        typebotSlug,
        typebotDelayMessage,
        typebotRestartMessage
    } = typebot;

    // Phone of the contact (chats may arrive by LID).
    const number = ticket.contact?.number || inbound.sender.jid.replace(/\D/g, '');

    let body = inbound.text;

    async function createSession(typebot, number) {
        try {
            const id = Math.floor(Math.random() * 10000000000).toString();

            const reqData = {
                "isStreamEnabled": true,
                "message": "string",
                "resultId": "string",
                "isOnlyRegistering": false,
                "prefilledVariables": {
                    "number": number,
                    "pushName": inbound.sender.name || ""
                },
            };

            const config = {
                method: 'post',
                maxBodyLength: Infinity,
                url: `${url}/api/v1/typebots/${typebotSlug}/startChat`,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                data: JSON.stringify(reqData)
            };

            const request = await axios.request(config);

            return request.data;

        } catch (err) {
            logger.info("Erro ao criar sessão do typebot: ", err)
            throw err;
        }
    }


    let sessionId
    let dataStart
    let status = false;
    try {
        const dataLimite = new Date()
        dataLimite.setMinutes(dataLimite.getMinutes() - Number(typebotExpires));


        if (typebotExpires > 0 && ticket.updatedAt < dataLimite) {
            await ticket.update({
                typebotSessionId: null,
                isBot: true
            });

            await ticket.reload();
        }

        if (isNil(ticket.typebotSessionId)) {
            dataStart = await createSession(typebot, number);
            sessionId = dataStart.sessionId
            status = true;
            await ticket.update({
                typebotSessionId: sessionId,
                typebotStatus: true,
                useIntegration: true,
                integrationId: typebot.id
            })
        } else {
            sessionId = ticket.typebotSessionId;
            status = ticket.typebotStatus;
        }

        if (!status) return;

        //let body = getConversationMessage(msg);        

        if (body !== typebotKeywordFinish && body !== typebotKeywordRestart) {
            let requestContinue
            let messages
            let input
            if (dataStart?.messages.length === 0 || dataStart === undefined) {
                const reqData = JSON.stringify({
                    "message": body
                });

                let config: AxiosRequestConfig = {
                    method: 'post',
                    maxBodyLength: Infinity,
                    url: `${url}/api/v1/sessions/${sessionId}/continueChat`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    data: reqData
                };
                requestContinue = await axios.request(config);
                messages = requestContinue.data?.messages;
                input = requestContinue.data?.input;
            } else {
                messages = dataStart?.messages;
                input = dataStart?.input;
            }

            if (messages?.length === 0) {
                await reply({ type: "text", text: typebotUnknownMessage });
            } else {
                for (const message of messages) {
                    if (message.type === 'text') {
                        let formattedText = '';
                        let linkPreview = false;
                        for (const richText of message.content.richText) {
                            for (const element of richText.children) {
                                let text = '';

                                if (element.text) {
                                    text = element.text;
                                }
                                if (element.type && element.children) {
                                    for (const subelement of element.children) {
                                        let text = '';

                                        if (subelement.text) {
                                            text = subelement.text;
                                        }

                                        if (subelement.type && subelement.children) {
                                            for (const subelement2 of subelement.children) {
                                                let text = '';

                                                if (subelement2.text) {
                                                    text = subelement2.text;
                                                }

                                                if (subelement2.bold) {
                                                    text = `*${text}*`;
                                                }
                                                if (subelement2.italic) {
                                                    text = `_${text}_`;
                                                }
                                                if (subelement2.underline) {
                                                    text = `~${text}~`;
                                                }
                                                if (subelement2.url) {
                                                    const linkText = subelement2.children[0].text;
                                                    text = `[${linkText}](${subelement2.url})`;
                                                    linkPreview = true;
                                                }
                                                formattedText += text;
                                            }
                                        }
                                        if (subelement.bold) {
                                            text = `*${text}*`;
                                        }
                                        if (subelement.italic) {
                                            text = `_${text}_`;
                                        }
                                        if (subelement.underline) {
                                            text = `~${text}~`;
                                        }
                                        if (subelement.url) {
                                            const linkText = subelement.children[0].text;
                                            text = `[${linkText}](${subelement.url})`;
                                            linkPreview = true;
                                        }
                                        formattedText += text;
                                    }
                                }

                                if (element.bold) {
                                    text = `*${text}*`
                                }
                                if (element.italic) {
                                    text = `_${text}_`;
                                }
                                if (element.underline) {
                                    text = `~${text}~`;
                                }

                                if (element.url) {
                                    const linkText = element.children[0].text;
                                    text = `[${linkText}](${element.url})`;
                                    linkPreview = true;
                                }

                                formattedText += text;
                            }
                            formattedText += '\n';
                        }
                        formattedText = formattedText.replace('**', '').replace(/\n$/, '');

                        if (formattedText === "Invalid message. Please, try again.") {
                            formattedText = typebotUnknownMessage;
                        }

                        if (formattedText.startsWith("#")) {
                            let gatilho = formattedText.replace("#", "");

                            try {
                                let jsonGatilho = JSON.parse(gatilho);

                                if (jsonGatilho.stopBot && isNil(jsonGatilho.userId) && isNil(jsonGatilho.queueId)) {
                                    await ticket.update({
                                        useIntegration: false,
                                        isBot: false
                                    })

                                    return;
                                }

                                if (!isNil(jsonGatilho.queueId) && jsonGatilho.queueId > 0 && isNil(jsonGatilho.userId)) {
                                    await UpdateTicketService({
                                        ticketData: {
                                            queueId: jsonGatilho.queueId,
                                            chatbot: false,
                                            useIntegration: false,
                                            integrationId: null
                                        },
                                        ticketId: ticket.id,
                                        companyId: ticket.companyId
                                    })
                                    return;
                                }

                                if (!isNil(jsonGatilho.queueId) && jsonGatilho.queueId > 0 && !isNil(jsonGatilho.userId) && jsonGatilho.userId > 0) {
                                    await UpdateTicketService({
                                        ticketData: {
                                            queueId: jsonGatilho.queueId,
                                            userId: jsonGatilho.userId,
                                            chatbot: false,
                                            useIntegration: false,
                                            integrationId: null
                                        },
                                        ticketId: ticket.id,
                                        companyId: ticket.companyId
                                    })

                                    return;
                                }
                            } catch (err) {
                                throw err
                            }
                        }

                        await typing();


                        await reply({ type: "text", text: formattedText });
                    }

                    if (message.type === 'audio') {
                        await typing();
                        await reply({ type: "audio", url: message.content.url, mimetype: "audio/mp4", voice: true });

                    }

                    // if (message.type === 'embed') {
                    //     await wbot.presenceSubscribe(msg.key.remoteJid)
                    //     //await delay(2000)
                    //     await wbot.sendPresenceUpdate('composing', msg.key.remoteJid)
                    //     await delay(typebotDelayMessage)
                    //     await wbot.sendPresenceUpdate('paused', msg.key.remoteJid)
                    //     const media = {

                    //         document: { url: message.content.url },
                    //         mimetype: 'application/pdf',
                    //         caption: ""

                    //     }
                    //     await wbot.sendMessage(msg.key.remoteJid, media);
                    // }

                    if (message.type === 'image') {
                        await typing();
                        await reply({ type: "image", url: message.content.url });
                    }

                    // if (message.type === 'video' ) {
                    //     await wbot.presenceSubscribe(msg.key.remoteJid)
                    //     //await delay(2000)
                    //     await wbot.sendPresenceUpdate('composing', msg.key.remoteJid)
                    //     await delay(typebotDelayMessage)
                    //     await wbot.sendPresenceUpdate('paused', msg.key.remoteJid)
                    //     const media = {
                    //         video: {
                    //             url: message.content.url,
                    //         },

                    //     }
                    //     await wbot.sendMessage(msg.key.remoteJid, media);
                    // }
                }

                if (input) {
                    if (input.type === 'choice input') {
                        let formattedText = '';

                        let dataButtons = {
                            buttonText: "Selecione umas das opções",
                            sections: [],
                            viewOnce: true,
                        };

                        const items = input.items;
                        const options = input.options || null;

                        if (options) {
                            dataButtons.buttonText = options.buttonLabel || "Selecione";

                            let rows = []

                            for (const item of items) {

                                rows.push({
                                    title: item.content,
                                    description: "",
                                    rowId: item.id
                                })
                            }
                            dataButtons.sections.push({ rows: rows });
                        }

                        for (const item of items) {
                            formattedText += `▶️ ${item.content}\n`;
                        }
                        formattedText = formattedText.replace(/\n$/, '');
                        await typing();

                        // List messages (sections) are no longer delivered by
                        // WhatsApp; the options go as text.
                        await reply({
                            type: "text",
                            text: options ? `Selecione uma das opções abaixo:\n${formattedText}` : formattedText
                        });

                    }
                }
            }
        }
        if (body === typebotKeywordRestart) {
            await ticket.update({
                isBot: true,
                typebotSessionId: null

            })

            await ticket.reload();

            await reply({ type: "text", text: typebotRestartMessage })

        }
        if (body === typebotKeywordFinish) {
            await UpdateTicketService({
                ticketData: {
                    status: "closed",
                    useIntegration: false,
                    integrationId: null
                },
                ticketId: ticket.id,
                companyId: ticket.companyId
            })

            return;
        }
    } catch (error) {
        logger.info("Error on typebotListener: ", error);
        await ticket.update({
            typebotSessionId: null
        })
        throw error;
    }
}

export default typebotListener;
