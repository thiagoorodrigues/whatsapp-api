import { QueryInterface, DataTypes } from "sequelize";

// Semantic search in the knowledge base: chunk vectors (pgvector, enabled by
// 20260928020000) and which embedding model each agent/document uses.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("AiAgents", "embeddingModel", { type: DataTypes.STRING, allowNull: true });
    await queryInterface.addColumn("AiKnowledgeDocuments", "embeddingModel", { type: DataTypes.STRING, allowNull: true });
    await queryInterface.addColumn("AiKnowledgeDocuments", "embeddingStatus", {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "none"
    });
    await queryInterface.addColumn("AiKnowledgeDocuments", "embeddingError", { type: DataTypes.TEXT, allowNull: true });
    await queryInterface.sequelize.query(`ALTER TABLE "AiKnowledgeChunks" ADD COLUMN embedding vector(1536)`);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`ALTER TABLE "AiKnowledgeChunks" DROP COLUMN embedding`);
    await queryInterface.removeColumn("AiKnowledgeDocuments", "embeddingError");
    await queryInterface.removeColumn("AiKnowledgeDocuments", "embeddingStatus");
    await queryInterface.removeColumn("AiKnowledgeDocuments", "embeddingModel");
    await queryInterface.removeColumn("AiAgents", "embeddingModel");
  }
};
