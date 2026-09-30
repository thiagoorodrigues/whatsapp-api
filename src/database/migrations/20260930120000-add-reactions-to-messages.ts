import { QueryInterface, DataTypes } from "sequelize";

// Reactions (emoji) people put on a message: one per person, kept on the
// message they react to.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "reactions", {
      type: DataTypes.JSONB,
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "reactions");
  }
};
