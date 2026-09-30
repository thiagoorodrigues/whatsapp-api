import { QueryInterface, DataTypes, QueryTypes } from "sequelize";

const company = {
  type: DataTypes.INTEGER,
  allowNull: false,
  references: { model: "Companies", key: "id" },
  onUpdate: "CASCADE",
  onDelete: "CASCADE"
};
const stamps = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false }
};
const ref = (model: string, onDelete: "CASCADE" | "SET NULL", allowNull = false) => ({
  type: DataTypes.INTEGER,
  allowNull,
  references: { model, key: "id" },
  onUpdate: "CASCADE",
  onDelete
});

const LOSS_REASONS = ["Preço", "Concorrente", "Sem resposta", "Sem interesse", "Outro"];

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.createTable("Funnels", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        name: { type: DataTypes.STRING, allowNull: false },
        color: { type: DataTypes.STRING, allowNull: false, defaultValue: "#2070F8" },
        position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ownDealsOnly: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...stamps
      }, opts);
      await queryInterface.createTable("FunnelStages", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        funnelId: ref("Funnels", "CASCADE"),
        name: { type: DataTypes.STRING, allowNull: false },
        color: { type: DataTypes.STRING, allowNull: false, defaultValue: "#64748B" },
        position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        kind: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "open" },
        archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...stamps
      }, opts);
      await queryInterface.createTable("FunnelQueues", {
        funnelId: { ...ref("Funnels", "CASCADE"), primaryKey: true },
        queueId: { ...ref("Queues", "CASCADE"), primaryKey: true },
        ...stamps
      }, opts);
      await queryInterface.createTable("LossReasons", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        name: { type: DataTypes.STRING, allowNull: false },
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps
      }, opts);
      await queryInterface.createTable("Deals", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        funnelId: ref("Funnels", "CASCADE"),
        stageId: ref("FunnelStages", "CASCADE"),
        contactId: ref("Contacts", "CASCADE"),
        userId: ref("Users", "SET NULL", true),
        title: { type: DataTypes.STRING, allowNull: false },
        value: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        expectedCloseDate: { type: DataTypes.DATEONLY, allowNull: true },
        source: { type: DataTypes.STRING(16), allowNull: true },
        notes: { type: DataTypes.TEXT, allowNull: true },
        status: { type: DataTypes.STRING(8), allowNull: false, defaultValue: "open" },
        lossReasonId: ref("LossReasons", "SET NULL", true),
        lossNote: { type: DataTypes.STRING, allowNull: true },
        position: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
        stageEnteredAt: { type: DataTypes.DATE, allowNull: false },
        closedAt: { type: DataTypes.DATE, allowNull: true },
        ...stamps
      }, opts);
      await queryInterface.addIndex("Deals", ["companyId", "funnelId", "stageId", "position"], opts);
      await queryInterface.addIndex("Deals", ["companyId", "contactId", "status"], opts);
      await queryInterface.createTable("DealEvents", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        dealId: ref("Deals", "CASCADE"),
        userId: ref("Users", "SET NULL", true),
        type: { type: DataTypes.STRING(16), allowNull: false },
        fromValue: { type: DataTypes.STRING, allowNull: true },
        toValue: { type: DataTypes.STRING, allowNull: true },
        ...stamps
      }, opts);
      await queryInterface.addIndex("DealEvents", ["dealId", "createdAt"], opts);
      await queryInterface.createTable("FunnelRules", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        companyId: company,
        funnelId: ref("Funnels", "CASCADE"),
        stageId: ref("FunnelStages", "CASCADE"),
        whatsappId: ref("Whatsapps", "CASCADE", true),
        queueId: ref("Queues", "CASCADE", true),
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ...stamps
      }, opts);

      await queryInterface.addColumn("Plans", "useCrm", {
        type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false
      }, opts);
      await queryInterface.addColumn("Plans", "crmFunnels", {
        type: DataTypes.INTEGER, allowNull: false, defaultValue: 1
      }, opts);

      const companies: { id: number }[] = await queryInterface.sequelize.query(
        `SELECT id FROM "Companies"`, { type: QueryTypes.SELECT, transaction }
      );
      const now = new Date();
      const rows = companies.flatMap(c =>
        LOSS_REASONS.map(name => ({ companyId: c.id, name, active: true, createdAt: now, updatedAt: now }))
      );
      if (rows.length) await queryInterface.bulkInsert("LossReasons", rows, opts);
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.removeColumn("Plans", "crmFunnels", opts);
      await queryInterface.removeColumn("Plans", "useCrm", opts);
      for (const table of ["FunnelRules", "DealEvents", "Deals", "LossReasons", "FunnelQueues", "FunnelStages", "Funnels"]) {
        await queryInterface.dropTable(table, opts);
      }
    });
  }
};
