import { QueryInterface, DataTypes } from "sequelize";

// Cor da conexão, usada na etiqueta da conexão nos atendimentos. Vazia = cor padrão.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "color", {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "color");
  }
};
