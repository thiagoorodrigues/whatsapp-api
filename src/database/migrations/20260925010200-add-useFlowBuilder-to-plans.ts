import { QueryInterface, DataTypes } from "sequelize";

// The flow chatbot replaces the queue chatbot every plan had, so existing
// plans keep a chatbot; new plans start without it.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Plans", "useFlowBuilder", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.sequelize.query('UPDATE "Plans" SET "useFlowBuilder" = true');
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Plans", "useFlowBuilder");
  }
};
