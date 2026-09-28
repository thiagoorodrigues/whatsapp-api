import { QueryInterface, DataTypes } from "sequelize";

// Knowledge base of the AI agents: documents split into chunks, searched
// with Postgres full-text search in Portuguese (accents ignored). The vector
// extension is enabled now so embeddings can be added to the chunks later
// without another infrastructure change.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query("CREATE EXTENSION IF NOT EXISTS vector");
    await queryInterface.sequelize.query("CREATE EXTENSION IF NOT EXISTS unaccent");
    // unaccent() is not IMMUTABLE, which generated columns require.
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION ai_unaccent(text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
        AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
    `);

    await queryInterface.createTable("AiKnowledgeDocuments", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      agentId: {
        type: DataTypes.INTEGER,
        references: { model: "AiAgents", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      title: { type: DataTypes.STRING(200), allowNull: false },
      description: { type: DataTypes.STRING(500), allowNull: true },
      // "file" (uploaded) or "text" (typed in the editor)
      sourceType: { type: DataTypes.STRING, allowNull: false, defaultValue: "file" },
      fileName: { type: DataTypes.STRING(300), allowNull: true },
      mimeType: { type: DataTypes.STRING, allowNull: true },
      // pending -> processing -> ready | error
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
      error: { type: DataTypes.TEXT, allowNull: true },
      // Whole text in the agent's prompt instead of searched.
      alwaysInclude: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      content: { type: DataTypes.TEXT, allowNull: true },
      charCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      chunkCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiKnowledgeDocuments", ["companyId", "agentId"]);

    await queryInterface.createTable("AiKnowledgeChunks", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      documentId: {
        type: DataTypes.INTEGER,
        references: { model: "AiKnowledgeDocuments", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      agentId: { type: DataTypes.INTEGER, allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false }
    });
    await queryInterface.sequelize.query(`
      ALTER TABLE "AiKnowledgeChunks"
        ADD COLUMN "searchVector" tsvector
        GENERATED ALWAYS AS (to_tsvector('portuguese', ai_unaccent(content))) STORED
    `);
    await queryInterface.sequelize.query(
      `CREATE INDEX "AiKnowledgeChunks_searchVector" ON "AiKnowledgeChunks" USING GIN ("searchVector")`
    );
    await queryInterface.addIndex("AiKnowledgeChunks", ["agentId"]);
    await queryInterface.addIndex("AiKnowledgeChunks", ["documentId"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AiKnowledgeChunks");
    await queryInterface.dropTable("AiKnowledgeDocuments");
    await queryInterface.sequelize.query("DROP FUNCTION IF EXISTS ai_unaccent(text)");
  }
};
