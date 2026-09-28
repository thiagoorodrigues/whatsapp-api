import { QueryInterface, DataTypes } from "sequelize";

// Media is kept on the server (public/company{id}/); S3 is no longer used.
module.exports = {
  up: (queryInterface: QueryInterface) => queryInterface.removeColumn("Messages", "isAws"),

  down: (queryInterface: QueryInterface) =>
    queryInterface.addColumn("Messages", "isAws", {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    })
};
