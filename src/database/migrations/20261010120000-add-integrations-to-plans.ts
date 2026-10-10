import { QueryInterface, DataTypes } from "sequelize";

// Partner integrations each plan sells, e.g. ["plamev"].
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Plans", "integrations", {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Plans", "integrations");
  }
};
