import { QueryInterface, DataTypes } from "sequelize";

// The agent description was not needed.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("AiAgents", "description");
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "description", { type: DataTypes.TEXT, allowNull: true });
  }
};
