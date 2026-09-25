import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Contacts", "lid", {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addIndex("Contacts", ["lid", "companyId"], {
      name: "contacts_lid_companyid"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Contacts", "contacts_lid_companyid");
    await queryInterface.removeColumn("Contacts", "lid");
  }
};
