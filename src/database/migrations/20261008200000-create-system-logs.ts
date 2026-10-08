import { QueryInterface, DataTypes } from "sequelize";

// Logs do sistema (requisições, erros da API, de segundo plano e do
// navegador). Sem FKs: o registro sobrevive à exclusão da empresa/usuário.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("SystemLogs", {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      level: { type: DataTypes.STRING(8), allowNull: false },
      source: { type: DataTypes.STRING(8), allowNull: false },
      protocol: { type: DataTypes.STRING(8), allowNull: true },
      companyId: { type: DataTypes.INTEGER, allowNull: true },
      userId: { type: DataTypes.INTEGER, allowNull: true },
      method: { type: DataTypes.STRING(8), allowNull: true },
      route: { type: DataTypes.STRING(255), allowNull: true },
      status: { type: DataTypes.SMALLINT, allowNull: true },
      durationMs: { type: DataTypes.INTEGER, allowNull: true },
      code: { type: DataTypes.STRING(80), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      detail: { type: DataTypes.TEXT, allowNull: true },
      context: { type: DataTypes.JSONB, allowNull: true }
    });
    await queryInterface.addIndex("SystemLogs", ["createdAt"]);
    await queryInterface.addIndex("SystemLogs", ["level", "createdAt"]);
    await queryInterface.addIndex("SystemLogs", ["companyId", "createdAt"]);
    await queryInterface.addIndex("SystemLogs", ["protocol"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("SystemLogs");
  }
};
