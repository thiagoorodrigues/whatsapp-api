import { QueryInterface, DataTypes } from "sequelize";

// OAuth for remote MCP servers.
// - AiOAuthClients: the platform's client registration at each authorization
//   server (dynamic registration), shared by every company and MCP server
//   that uses that authorization server.
// - AiMcpConnections: one authorized account per MCP server of an agent.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiOAuthClients", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      issuer: { type: DataTypes.STRING(1000), allowNull: false },
      redirectUri: { type: DataTypes.STRING(1000), allowNull: false },
      clientId: { type: DataTypes.STRING(1000), allowNull: false },
      clientSecretEncrypted: { type: DataTypes.TEXT, allowNull: true },
      authMethod: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiOAuthClients", ["issuer", "redirectUri"], { unique: true });

    await queryInterface.createTable("AiMcpConnections", {
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
        allowNull: true
      },
      // Id of the MCP server entry inside the agent's tools.
      serverId: { type: DataTypes.STRING, allowNull: false },
      serverUrl: { type: DataTypes.STRING(2000), allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
      issuer: { type: DataTypes.STRING(1000), allowNull: true },
      tokenEndpoint: { type: DataTypes.STRING(2000), allowNull: true },
      resource: { type: DataTypes.STRING(2000), allowNull: true },
      scope: { type: DataTypes.TEXT, allowNull: true },
      clientId: { type: DataTypes.STRING(1000), allowNull: true },
      clientSecretEncrypted: { type: DataTypes.TEXT, allowNull: true },
      authMethod: { type: DataTypes.STRING, allowNull: true },
      accessTokenEncrypted: { type: DataTypes.TEXT, allowNull: true },
      refreshTokenEncrypted: { type: DataTypes.TEXT, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      // Pending authorization (cleared when it completes).
      state: { type: DataTypes.STRING, allowNull: true },
      codeVerifierEncrypted: { type: DataTypes.TEXT, allowNull: true },
      stateExpiresAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.TEXT, allowNull: true },
      connectedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiMcpConnections", ["companyId", "serverId"], { unique: true });
    await queryInterface.addIndex("AiMcpConnections", ["state"], { unique: true });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AiMcpConnections");
    await queryInterface.dropTable("AiOAuthClients");
  }
};
