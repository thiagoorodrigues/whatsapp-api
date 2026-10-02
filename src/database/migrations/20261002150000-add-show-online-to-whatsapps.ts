import { QueryInterface, DataTypes } from "sequelize";

// "Exibir status online" passa a ser de cada conexão. Desligado por padrão:
// enquanto o número aparece online no WeConex, o celular não recebe
// notificação de mensagem.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "showOnline", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "showOnline");
  }
};
