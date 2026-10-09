import { QueryInterface, DataTypes } from "sequelize";

// O agente de IA trocou o setor do atendimento mas continua respondendo
// (transferência com "só trocar o setor").
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Tickets", "aiAgentKept", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tickets", "aiAgentKept");
  }
};
