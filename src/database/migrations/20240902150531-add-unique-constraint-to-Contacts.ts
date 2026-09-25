import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {     
    return queryInterface.addConstraint("Contacts", ["number", "companyId", "whatsappId"], {
      type: "unique",
      name: "number_companyid_whatsappId_unique"
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.removeConstraint(
      "Contacts",
      "number_companyid_whatsappId_unique"
    );  
  }
};
