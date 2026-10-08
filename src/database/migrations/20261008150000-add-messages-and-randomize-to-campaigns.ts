import { QueryInterface, DataTypes } from "sequelize";

// Campaigns take up to 10 messages. randomizeMessages: on, each contact gets
// one of them at random (as before); off, each contact gets all, in order.
const EXTRA = ["message6", "message7", "message8", "message9", "message10"];

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    for (const column of EXTRA) {
      await queryInterface.addColumn("Campaigns", column, { type: DataTypes.TEXT, allowNull: true, defaultValue: "" });
    }
    await queryInterface.addColumn("Campaigns", "randomizeMessages", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Campaigns", "randomizeMessages");
    for (const column of EXTRA) {
      await queryInterface.removeColumn("Campaigns", column);
    }
  }
};
