import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Whatsapps", "importMessages", {
        type: DataTypes.BOOLEAN,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: false
      }),
      queryInterface.addColumn("Whatsapps", "initialDate", {
        type: DataTypes.DATEONLY,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Whatsapps", "finalDate", {
        type: DataTypes.DATEONLY,
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true,
        defaultValue: null
      })
    ])
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Whatsapps", "importMessages"),
      queryInterface.removeColumn("Whatsapps", "initialDate"),
      queryInterface.removeColumn("Whatsapps", "finalDate"),
    ])
  }
};
