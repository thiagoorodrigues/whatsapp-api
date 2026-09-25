import { QueryInterface, DataTypes } from "sequelize";

// Connection -> flow that answers new conversations; ticket -> where the
// conversation is inside that flow.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "flowId", {
      type: DataTypes.INTEGER,
      references: { model: "Flows", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });
    await queryInterface.addColumn("Tickets", "flowId", {
      type: DataTypes.INTEGER,
      references: { model: "Flows", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });
    await queryInterface.addColumn("Tickets", "flowNodeId", {
      type: DataTypes.STRING,
      allowNull: true
    });
    await queryInterface.addColumn("Tickets", "flowVariables", {
      type: DataTypes.JSONB,
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tickets", "flowVariables");
    await queryInterface.removeColumn("Tickets", "flowNodeId");
    await queryInterface.removeColumn("Tickets", "flowId");
    await queryInterface.removeColumn("Whatsapps", "flowId");
  }
};
