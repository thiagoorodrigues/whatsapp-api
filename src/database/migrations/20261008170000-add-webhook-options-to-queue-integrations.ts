import { QueryInterface, DataTypes } from "sequelize";

// Webhook options (same as SwEasy). The defaults keep what existing webhooks
// already did: messages of tickets waiting (pending), customer's only.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const bool = (defaultValue: boolean) => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue });
    await queryInterface.addColumn("QueueIntegrations", "webhookActive", bool(true));
    await queryInterface.addColumn("QueueIntegrations", "webhookOnPending", bool(true));
    await queryInterface.addColumn("QueueIntegrations", "webhookOnOpen", bool(false));
    await queryInterface.addColumn("QueueIntegrations", "webhookSendTags", bool(false));
    await queryInterface.addColumn("QueueIntegrations", "webhookSendQueue", bool(false));
    await queryInterface.addColumn("QueueIntegrations", "webhookSendBotMessages", bool(false));
    // Bearer token, encrypted (helpers/secretBox).
    await queryInterface.addColumn("QueueIntegrations", "webhookToken", { type: DataTypes.TEXT, allowNull: true });
  },

  down: async (queryInterface: QueryInterface) => {
    for (const column of [
      "webhookToken",
      "webhookSendBotMessages",
      "webhookSendQueue",
      "webhookSendTags",
      "webhookOnOpen",
      "webhookOnPending",
      "webhookActive"
    ]) {
      await queryInterface.removeColumn("QueueIntegrations", column);
    }
  }
};
