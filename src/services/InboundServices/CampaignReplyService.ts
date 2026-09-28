import moment from "moment";
import { Op } from "sequelize";
import { InboundMessage } from "../../channels/inbound";
import Campaign from "../../models/Campaign";
import CampaignShipping from "../../models/CampaignShipping";
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
