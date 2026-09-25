import { QueryInterface, DataTypes } from "sequelize";

/**
 * Drops the tables and columns of modules removed from the app:
 * Informativos (Announcements), Chat Interno (Chats, ChatUsers,
 * ChatMessages) and Open.Ai (Prompts + promptId columns), plus the plan
 * flags that toggled them.
 *
 * DESTRUCTIVE: `up` deletes any data in these tables. `down` only recreates
 * the empty structure; it cannot bring the data back.
 *
 * Every step checks that the table/column still exists, so the migration
 * can run on databases in any state.
 */

const PROMPT_COLUMNS = ["Whatsapps", "Queues", "Tickets"];
const PLAN_FLAGS = ["useInternalChat", "useOpenAi"];
// Children before parents: FKs point from ChatUsers/ChatMessages to Chats.
const TABLES = ["ChatMessages", "ChatUsers", "Chats", "Announcements", "Prompts"];

const hasColumn = async (qi: QueryInterface, table: string, column: string) => {
  const info = (await qi.describeTable(table)) as Record<string, unknown>;
  return Boolean(info[column]);
};

const tableNames = async (qi: QueryInterface): Promise<string[]> => {
  const tables: any[] = await qi.showAllTables();
  return tables.map(t => (typeof t === "string" ? t : t.tableName));
};

const timestamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};
const id = {
  type: DataTypes.INTEGER,
  autoIncrement: true,
  primaryKey: true,
  allowNull: false
};
const fk = (model: string, onDelete = "CASCADE", allowNull = false) => ({
  type: DataTypes.INTEGER,
  references: { model, key: "id" },
  onUpdate: "CASCADE",
  onDelete,
  allowNull
});

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // promptId columns reference Prompts, so they go before the table.
    for (const table of PROMPT_COLUMNS) {
      if (await hasColumn(queryInterface, table, "promptId")) {
        await queryInterface.removeColumn(table, "promptId");
      }
    }

    const existing = await tableNames(queryInterface);
    for (const table of TABLES) {
      if (existing.includes(table)) {
        await queryInterface.dropTable(table);
      }
    }

    for (const flag of PLAN_FLAGS) {
      if (await hasColumn(queryInterface, "Plans", flag)) {
        await queryInterface.removeColumn("Plans", flag);
      }
    }
  },

  down: async (queryInterface: QueryInterface) => {
    for (const flag of PLAN_FLAGS) {
      if (!(await hasColumn(queryInterface, "Plans", flag))) {
        await queryInterface.addColumn("Plans", flag, {
          type: DataTypes.BOOLEAN,
          defaultValue: true
        });
      }
    }

    const existing = await tableNames(queryInterface);

    if (!existing.includes("Prompts")) {
      await queryInterface.createTable("Prompts", {
        id,
        name: { type: DataTypes.TEXT, allowNull: false },
        apiKey: { type: DataTypes.TEXT, allowNull: false },
        prompt: { type: DataTypes.TEXT, allowNull: false },
        maxTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
        maxMessages: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
        temperature: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        promptTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        completionTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        totalTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        voice: { type: DataTypes.TEXT, allowNull: true },
        voiceKey: { type: DataTypes.TEXT, allowNull: true },
        voiceRegion: { type: DataTypes.TEXT, allowNull: true },
        queueId: { ...fk("Queues", "NO ACTION"), onUpdate: "NO ACTION" },
        companyId: { ...fk("Companies", "NO ACTION"), onUpdate: "NO ACTION" },
        createdAt: { type: DataTypes.DATE(6), allowNull: false },
        updatedAt: { type: DataTypes.DATE(6), allowNull: false }
      });
    }

    if (!existing.includes("Announcements")) {
      await queryInterface.createTable("Announcements", {
        id,
        priority: { type: DataTypes.INTEGER, allowNull: true },
        title: { type: DataTypes.STRING, allowNull: false },
        text: { type: DataTypes.TEXT, allowNull: false },
        mediaPath: { type: DataTypes.TEXT, allowNull: true },
        mediaName: { type: DataTypes.TEXT, allowNull: true },
        companyId: fk("Companies"),
        status: { type: DataTypes.BOOLEAN, allowNull: true },
        ...timestamps
      });
    }

    if (!existing.includes("Chats")) {
      await queryInterface.createTable("Chats", {
        id,
        title: { type: DataTypes.TEXT, defaultValue: "", allowNull: true },
        uuid: { type: DataTypes.STRING, defaultValue: "", allowNull: true },
        ownerId: fk("Users"),
        lastMessage: { type: DataTypes.TEXT, allowNull: true },
        companyId: fk("Companies"),
        ...timestamps
      });
    }

    if (!existing.includes("ChatUsers")) {
      await queryInterface.createTable("ChatUsers", {
        id,
        chatId: fk("Chats"),
        userId: fk("Users"),
        unreads: { type: DataTypes.INTEGER, defaultValue: 0 },
        ...timestamps
      });
    }

    if (!existing.includes("ChatMessages")) {
      await queryInterface.createTable("ChatMessages", {
        id,
        chatId: fk("Chats"),
        senderId: fk("Users"),
        message: { type: DataTypes.TEXT, allowNull: true, defaultValue: "" },
        mediaPath: { type: DataTypes.TEXT, allowNull: true },
        mediaName: { type: DataTypes.TEXT, allowNull: true },
        isFile: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
        mimeType: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
        ...timestamps
      });
    }

    if (!(await hasColumn(queryInterface, "Whatsapps", "promptId"))) {
      await queryInterface.addColumn("Whatsapps", "promptId", {
        type: DataTypes.INTEGER,
        references: { model: "Prompts", key: "id" },
        onUpdate: "RESTRICT",
        onDelete: "RESTRICT"
      });
    }
    if (!(await hasColumn(queryInterface, "Queues", "promptId"))) {
      await queryInterface.addColumn("Queues", "promptId", {
        type: DataTypes.INTEGER,
        references: { model: "Prompts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      });
    }
    if (!(await hasColumn(queryInterface, "Tickets", "promptId"))) {
      await queryInterface.addColumn("Tickets", "promptId", {
        type: DataTypes.STRING,
        defaultValue: null,
        allowNull: true
      });
    }
  }
};
