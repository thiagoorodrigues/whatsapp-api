import { QueryInterface, DataTypes } from "sequelize";

// Internal notes: messages only the team sees, never sent to WhatsApp.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "isPrivate", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    // Who wrote the note; other messages keep it null.
    await queryInterface.addColumn("Messages", "userId", {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "userId");
    await queryInterface.removeColumn("Messages", "isPrivate");
  }
};
