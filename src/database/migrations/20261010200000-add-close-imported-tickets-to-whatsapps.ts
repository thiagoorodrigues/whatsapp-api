import { QueryInterface, DataTypes } from "sequelize";

// History import: imported conversations closed (default, as before) or pending.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "closeImportedTickets", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "closeImportedTickets");
  }
};
