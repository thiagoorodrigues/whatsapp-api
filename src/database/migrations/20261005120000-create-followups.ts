import { QueryInterface, DataTypes } from "sequelize";

// Réguas de follow-up: etapas enviadas quando o cliente para de responder.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("FollowUpRules", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Companies", key: "id" }, onDelete: "CASCADE" },
      name: { type: DataTypes.STRING, allowNull: false },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      trigger: { type: DataTypes.STRING, allowNull: false, defaultValue: "no_reply" },
      whatsappId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Whatsapps", key: "id" }, onDelete: "SET NULL" },
      queueId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Queues", key: "id" }, onDelete: "SET NULL" },
      respectBusinessHours: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      finalActions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      aiAgentId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "AiAgents", key: "id" }, onDelete: "SET NULL" },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("FollowUpRules", ["companyId"]);

    await queryInterface.createTable("FollowUpSteps", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      ruleId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "FollowUpRules", key: "id" }, onDelete: "CASCADE" },
      order: { type: DataTypes.INTEGER, allowNull: false },
      delayMinutes: { type: DataTypes.INTEGER, allowNull: false },
      mode: { type: DataTypes.STRING, allowNull: false, defaultValue: "text" },
      body: { type: DataTypes.TEXT, allowNull: false },
      mediaPath: { type: DataTypes.STRING, allowNull: true },
      mediaName: { type: DataTypes.STRING, allowNull: true },
      aiInstruction: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("FollowUpSteps", ["ruleId", "order"]);

    await queryInterface.createTable("FollowUpEnrollments", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Companies", key: "id" }, onDelete: "CASCADE" },
      ruleId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "FollowUpRules", key: "id" }, onDelete: "CASCADE" },
      ticketId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Tickets", key: "id" }, onDelete: "CASCADE" },
      contactId: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Contacts", key: "id" }, onDelete: "SET NULL" },
      currentStep: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      nextRunAt: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
      stopReason: { type: DataTypes.STRING, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lastSentAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.sequelize.query(
      `CREATE INDEX "FollowUpEnrollments_due" ON "FollowUpEnrollments" ("nextRunAt") WHERE status = 'active'`
    );
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "FollowUpEnrollments_one_active_per_ticket" ON "FollowUpEnrollments" ("ticketId") WHERE status = 'active'`
    );
    await queryInterface.addIndex("FollowUpEnrollments", ["ruleId", "status"]);

    await queryInterface.addColumn("Messages", "followUpEnrollmentId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "FollowUpEnrollments", key: "id" },
      onDelete: "SET NULL"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "followUpEnrollmentId");
    await queryInterface.dropTable("FollowUpEnrollments");
    await queryInterface.dropTable("FollowUpSteps");
    await queryInterface.dropTable("FollowUpRules");
  }
};
