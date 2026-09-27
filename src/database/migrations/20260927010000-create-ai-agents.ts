import { QueryInterface, DataTypes } from "sequelize";

// AI agents module: per-company provider keys (encrypted), agents, which
// connection each agent answers, run log, and the plan flag.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiCredentials", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      provider: { type: DataTypes.STRING, allowNull: false },
      apiKeyEncrypted: { type: DataTypes.TEXT, allowNull: false },
      keyHint: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiCredentials", ["companyId", "provider"], {
      unique: true,
      name: "ai_credentials_company_provider"
    });

    await queryInterface.createTable("AiAgents", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      name: { type: DataTypes.STRING, allowNull: false },
      provider: { type: DataTypes.STRING, allowNull: false },
      model: { type: DataTypes.STRING, allowNull: false },
      prompt: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      effort: { type: DataTypes.STRING, allowNull: true },
      historySize: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 20 },
      tools: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.createTable("AiAgentRuns", {
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
      ticketId: {
        type: DataTypes.INTEGER,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      provider: { type: DataTypes.STRING, allowNull: false },
      model: { type: DataTypes.STRING, allowNull: false },
      inputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      outputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      toolCalls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      reply: { type: DataTypes.TEXT, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      durationMs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiAgentRuns", ["companyId", "createdAt"], {
      name: "ai_agent_runs_company_created"
    });

    await queryInterface.addColumn("Whatsapps", "aiAgentId", {
      type: DataTypes.INTEGER,
      references: { model: "AiAgents", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      allowNull: true
    });

    // Set when the agent hands the conversation to people; cleared on close.
    await queryInterface.addColumn("Tickets", "aiStoppedAt", {
      type: DataTypes.DATE,
      allowNull: true
    });

    await queryInterface.addColumn("Plans", "useAiAgents", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Plans", "useAiAgents");
    await queryInterface.removeColumn("Tickets", "aiStoppedAt");
    await queryInterface.removeColumn("Whatsapps", "aiAgentId");
    await queryInterface.dropTable("AiAgentRuns");
    await queryInterface.dropTable("AiAgents");
    await queryInterface.dropTable("AiCredentials");
  }
};
