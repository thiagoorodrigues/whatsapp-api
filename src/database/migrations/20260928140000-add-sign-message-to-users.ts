import { QueryInterface, DataTypes } from "sequelize";

// Whether the user's name goes on top of the messages they send. It used to
// be a switch kept in each browser; now it belongs to the user.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Users", "signMessage", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Users", "signMessage");
  }
};
