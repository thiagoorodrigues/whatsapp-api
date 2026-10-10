import { QueryInterface, DataTypes } from "sequelize";

// One row per company and partner integration; the token is AES-GCM encrypted.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("CompanyIntegrations", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      provider: { type: DataTypes.STRING, allowNull: false },
      tokenEncrypted: { type: DataTypes.TEXT, allowNull: false },
      tokenHint: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "connected" },
      lastCheckedAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("CompanyIntegrations", ["companyId", "provider"], {
      unique: true,
      name: "company_integrations_company_provider"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("CompanyIntegrations");
  }
};
