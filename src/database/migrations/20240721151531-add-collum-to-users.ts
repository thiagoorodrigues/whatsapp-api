import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Users", "status", {
        type: DataTypes.BOOLEAN,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: true
      })
    ])
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Users", "status")            
    ])
  }
};
