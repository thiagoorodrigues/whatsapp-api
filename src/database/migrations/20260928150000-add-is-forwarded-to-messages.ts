import { QueryInterface, DataTypes } from "sequelize";

// Messages that arrived or went out marked as forwarded ("Encaminhada").
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "isForwarded", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    // Older messages: the WhatsApp payload already says it.
    await queryInterface.sequelize.query(
      `UPDATE "Messages" SET "isForwarded" = true WHERE "dataJson" LIKE '%"isForwarded":true%'`
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "isForwarded");
  }
};
