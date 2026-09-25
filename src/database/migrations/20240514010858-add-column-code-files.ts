import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.addColumn("Files", "code", {
      type: DataTypes.STRING,            
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeColumn("Files", "code");
  }
};
