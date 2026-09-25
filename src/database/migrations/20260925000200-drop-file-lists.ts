import { QueryInterface, DataTypes } from "sequelize";

/**
 * Drops the "Lista de arquivos" module: the Files and FilesOptions tables and
 * the Campaigns.fileListId column that pointed at them.
 *
 * DESTRUCTIVE: `up` deletes every file list record. The uploaded files under
 * public/fileList are not touched by this migration. `down` only recreates
 * the empty structure; it cannot bring the records back.
 */

const tableNames = async (qi: QueryInterface): Promise<string[]> => {
  const tables: any[] = await qi.showAllTables();
  return tables.map(t => (typeof t === "string" ? t : t.tableName));
};

const hasColumn = async (qi: QueryInterface, table: string, column: string) => {
  const info = (await qi.describeTable(table)) as Record<string, unknown>;
  return Boolean(info[column]);
};

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Campaigns.fileListId references Files, so it goes first.
    if (await hasColumn(queryInterface, "Campaigns", "fileListId")) {
      await queryInterface.removeColumn("Campaigns", "fileListId");
    }

    const existing = await tableNames(queryInterface);
    // FilesOptions.fileId references Files: child before parent.
    for (const table of ["FilesOptions", "Files"]) {
      if (existing.includes(table)) {
        await queryInterface.dropTable(table);
      }
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const existing = await tableNames(queryInterface);

    if (!existing.includes("Files")) {
      await queryInterface.createTable("Files", {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false
        },
        companyId: {
          type: DataTypes.INTEGER,
          references: { model: "Companies", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false
        },
        name: { type: DataTypes.STRING, allowNull: false },
        message: { type: DataTypes.TEXT, allowNull: false },
        code: { type: DataTypes.STRING },
        createdAt: { type: DataTypes.DATE(6), allowNull: false },
        updatedAt: { type: DataTypes.DATE(6), allowNull: false }
      });
    }

    if (!existing.includes("FilesOptions")) {
      await queryInterface.createTable("FilesOptions", {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false
        },
        name: { type: DataTypes.STRING, allowNull: false },
        path: { type: DataTypes.STRING, allowNull: false },
        fileId: {
          type: DataTypes.INTEGER,
          references: { model: "Files", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false
        },
        mediaType: { type: DataTypes.STRING, defaultValue: "", allowNull: true },
        createdAt: { type: DataTypes.DATE(6), allowNull: false },
        updatedAt: { type: DataTypes.DATE(6), allowNull: false }
      });
    }

    if (!(await hasColumn(queryInterface, "Campaigns", "fileListId"))) {
      await queryInterface.addColumn("Campaigns", "fileListId", {
        type: DataTypes.INTEGER,
        references: { model: "Files", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      });
    }
  }
};
