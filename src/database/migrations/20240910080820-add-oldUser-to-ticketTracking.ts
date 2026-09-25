import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.addColumn("TicketTraking", "oldUserId", {
      type: DataTypes.INTEGER,
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true,
      defaultValue: null
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeColumn("TicketTraking", "oldUserId");
  }
};