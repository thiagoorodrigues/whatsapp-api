import { QueryInterface, DataTypes } from "sequelize";

// Agents get a lifecycle status (draft/active/paused) instead of an on/off
// flag, a description, and optional output limits.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "description", { type: DataTypes.TEXT, allowNull: true });
    await queryInterface.addColumn("AiAgents", "status", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "draft"
    });
    await queryInterface.addColumn("AiAgents", "maxTokens", { type: DataTypes.INTEGER, allowNull: true });
    await queryInterface.addColumn("AiAgents", "temperature", { type: DataTypes.FLOAT, allowNull: true });
    await queryInterface.sequelize.query(
      `UPDATE "AiAgents" SET "status" = CASE WHEN "isActive" THEN 'active' ELSE 'paused' END`
    );
    await queryInterface.removeColumn("AiAgents", "isActive");
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "isActive", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
    await queryInterface.sequelize.query(`UPDATE "AiAgents" SET "isActive" = ("status" = 'active')`);
    await queryInterface.removeColumn("AiAgents", "temperature");
    await queryInterface.removeColumn("AiAgents", "maxTokens");
    await queryInterface.removeColumn("AiAgents", "status");
    await queryInterface.removeColumn("AiAgents", "description");
  }
};
