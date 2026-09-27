import { QueryInterface, DataTypes } from "sequelize";

// The agent reads the ticket's own conversation (bounded in code), so the
// per-agent history size setting goes away.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("AiAgents", "historySize");
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "historySize", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 20
    });
  }
};
