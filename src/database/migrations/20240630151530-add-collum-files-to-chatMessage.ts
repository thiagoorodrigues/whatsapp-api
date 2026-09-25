import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Messages", "isAws", {
        type: DataTypes.BOOLEAN,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: false
      })
    ])
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Messages", "isAws"),      
    ])
  }
};
