import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.addColumn("Schedules", "whatsappsId", {
      type: DataTypes.INTEGER,   
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true,
      defaultValue: null         
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeColumn("Schedules", "whatsappsId");
  }
};
