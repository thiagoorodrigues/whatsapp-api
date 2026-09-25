import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.addColumn("Messages", "messagesWhatsappsId", {
      type: DataTypes.STRING,   
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true,
      defaultValue: null         
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeColumn("Messages", "messagesWhatsappsId");
  }
};
