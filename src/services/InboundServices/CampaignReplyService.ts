import moment from "moment";
import { Op } from "sequelize";
import { InboundMessage } from "../../channels/inbound";
import { getIO } from "../../libs/socket";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { campaignQueue, parseToMilliseconds, randomValue } from "../../queues";

// A reply to a campaign that asks for confirmation sends the campaign
// message itself.
export const verifyRecentCampaign = async (inbound: InboundMessage) => {
  const { companyId } = inbound;
  if (!inbound.fromMe) {
    const number = inbound.sender.jid.replace(/\D/g, "");
    const campaigns = await Campaign.findAll({
      where: { companyId, status: "EM_ANDAMENTO", confirmation: true },
    });
    if (campaigns) {
      const ids = campaigns.map((c) => c.id);
      const campaignShipping = await CampaignShipping.findOne({
        where: { campaignId: { [Op.in]: ids }, number, confirmation: null },
      });

      if (campaignShipping) {
        await campaignShipping.update({
          confirmedAt: moment(),
          confirmation: true,
        });
        await campaignQueue.add(
          "DispatchCampaign",
          {
            campaignShippingId: campaignShipping.id,
            campaignId: campaignShipping.campaignId,
          },
          {
            delay: parseToMilliseconds(randomValue(0, 10)),
          }
        );
      }
    }
  }
};

// Campaign messages open a ticket through their echo (U+200C marks them);
// it is closed right away.
export const verifyCampaignMessageAndCloseTicket = async (inbound: InboundMessage) => {
  const { companyId } = inbound;
  const io = getIO();
  const isCampaign = /\u200c/.test(inbound.text);
  if (inbound.fromMe && isCampaign) {
    const messageRecord = await Message.findOne({
      where: { messagesWhatsappsId: inbound.externalId, companyId },
    });
    if (!messageRecord) return;

    const ticket = await Ticket.findByPk(messageRecord.ticketId);
    await ticket.update({ status: "closed" });

    io.to("open").emit(`company-${ticket.companyId}-ticket`, {
      action: "delete",
      ticket,
      ticketId: ticket.id,
    });

    io.to(ticket.status)
      .to(ticket.id.toString())
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id,
      });
  }
};
