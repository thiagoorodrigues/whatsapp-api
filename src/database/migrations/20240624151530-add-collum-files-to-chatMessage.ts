import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("ChatMessages", "isFile", {
        type: DataTypes.BOOLEAN,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: false
      }),
      queryInterface.addColumn("ChatMessages", "mimeType", {
        type: DataTypes.TEXT,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: null
      })
    ])
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("ChatMessages", "isFile"),
      queryInterface.removeColumn("ChatMessages", "mimeType"),
    ])
  }
};
