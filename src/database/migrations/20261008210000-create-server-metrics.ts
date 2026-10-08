import { QueryInterface, DataTypes } from "sequelize";

// Uma leitura por minuto do monitor do servidor (CPU, memória, load, disco).
// Retenção de 7 dias pela limpeza diária.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("ServerMetrics", {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      cpuPercent: { type: DataTypes.FLOAT, allowNull: true },
      load1: { type: DataTypes.FLOAT, allowNull: false },
      load5: { type: DataTypes.FLOAT, allowNull: false },
      load15: { type: DataTypes.FLOAT, allowNull: false },
      memUsedBytes: { type: DataTypes.BIGINT, allowNull: true },
      memTotalBytes: { type: DataTypes.BIGINT, allowNull: true },
      apiMemBytes: { type: DataTypes.BIGINT, allowNull: true },
      diskUsedBytes: { type: DataTypes.BIGINT, allowNull: true },
      diskTotalBytes: { type: DataTypes.BIGINT, allowNull: true }
    });
    await queryInterface.addIndex("ServerMetrics", ["createdAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ServerMetrics");
  }
};
