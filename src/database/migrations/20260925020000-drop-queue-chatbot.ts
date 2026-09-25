import { QueryInterface, DataTypes } from "sequelize";

// The queue chatbot (options tree and numbered queue menu) was replaced by
// the flow builder (Flows). `down` recreates the structure only; the options
// and settings themselves are not restored.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tickets", "queueOptionId");
    await queryInterface.dropTable("QueueOptions");
    await queryInterface.removeColumn("Tickets", "amountUsedBotQueues");
    await queryInterface.removeColumn("TicketTraking", "chatbotAt");
    await queryInterface.removeColumn("Whatsapps", "maxUseBotQueues");
    await queryInterface.removeColumn("Whatsapps", "timeUseBotQueues");
    await queryInterface.bulkDelete("Settings", { key: "chatBotType" });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "timeUseBotQueues", {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: true
    });
    await queryInterface.addColumn("Whatsapps", "maxUseBotQueues", {
      type: DataTypes.INTEGER,
      defaultValue: 3,
      allowNull: true
    });
    await queryInterface.addColumn("TicketTraking", "chatbotAt", {
      type: DataTypes.DATE,
      allowNull: true
    });
    await queryInterface.addColumn("Tickets", "amountUsedBotQueues", {
      type: DataTypes.INTEGER,
      defaultValue: 0
    });
    await queryInterface.createTable("QueueOptions", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: true },
      option: { type: DataTypes.TEXT, allowNull: true },
      queueId: {
        type: DataTypes.INTEGER,
        references: { model: "Queues", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      parentId: {
        type: DataTypes.INTEGER,
        references: { model: "QueueOptions", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: true
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addColumn("Tickets", "queueOptionId", {
      type: DataTypes.INTEGER,
      references: { model: "QueueOptions", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });
  }
};
