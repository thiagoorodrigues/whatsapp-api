import { QueryInterface, DataTypes } from "sequelize";

// Phone number of the WhatsApp account behind each connection. Filled in by
// libs/wbot.ts every time the connection opens.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = (await queryInterface.describeTable("Whatsapps")) as Record<string, unknown>;
    if (!table.number) {
      await queryInterface.addColumn("Whatsapps", "number", {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "number");
  }
};
