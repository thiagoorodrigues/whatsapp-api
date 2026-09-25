import { QueryInterface, DataTypes } from "sequelize";

/**
 * Drops the Helps table of the removed "Ajuda" module.
 *
 * DESTRUCTIVE: `up` deletes the help entries. `down` only recreates the
 * empty table; it cannot bring the data back.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const tables: any[] = await queryInterface.showAllTables();
    const names = tables.map(t => (typeof t === "string" ? t : t.tableName));
    if (names.includes("Helps")) {
      await queryInterface.dropTable("Helps");
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const tables: any[] = await queryInterface.showAllTables();
    const names = tables.map(t => (typeof t === "string" ? t : t.tableName));
    if (names.includes("Helps")) return;
    await queryInterface.createTable("Helps", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      title: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      video: { type: DataTypes.STRING, allowNull: true },
      link: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
  }
};
