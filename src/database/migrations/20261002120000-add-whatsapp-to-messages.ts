import { QueryInterface, DataTypes } from "sequelize";

// Each connection keeps its own copy of a conversation: the same number paired
// on two connections receives the same messages, with the same ids. The id
// on WhatsApp is only unique per connection.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "whatsappId", {
      type: DataTypes.INTEGER,
      references: { model: "Whatsapps", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });
    await queryInterface.sequelize.query(
      `UPDATE "Messages" m SET "whatsappId" = t."whatsappId" FROM "Tickets" t WHERE t.id = m."ticketId"`
    );
    await queryInterface.addIndex("Messages", ["whatsappId", "messagesWhatsappsId"], {
      name: "idx_messages_whatsapp_external_id"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Messages", "idx_messages_whatsapp_external_id");
    await queryInterface.removeColumn("Messages", "whatsappId");
  }
};
