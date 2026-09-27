import { QueryInterface, DataTypes } from "sequelize";

// Each agent keeps its own provider key (encrypted) instead of one key per
// company and provider.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "apiKeyEncrypted", { type: DataTypes.TEXT, allowNull: true });
    await queryInterface.addColumn("AiAgents", "keyHint", { type: DataTypes.STRING, allowNull: true });
    await queryInterface.dropTable("AiCredentials");
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiCredentials", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      provider: { type: DataTypes.STRING, allowNull: false },
      apiKeyEncrypted: { type: DataTypes.TEXT, allowNull: false },
      keyHint: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.removeColumn("AiAgents", "keyHint");
    await queryInterface.removeColumn("AiAgents", "apiKeyEncrypted");
  }
};
