import { QueryInterface, DataTypes, QueryTypes } from "sequelize";

// Nome no JSON antigo -> tipo de chave do Baileys.
const LEGACY_MAP: { [legacy: string]: string } = {
  preKeys: "pre-key",
  sessions: "session",
  senderKeys: "sender-key",
  appStateSyncKeys: "app-state-sync-key",
  appStateVersions: "app-state-sync-version",
  senderKeyMemory: "sender-key-memory",
  lidMapping: "lid-mapping",
  deviceList: "device-list",
  tctokens: "tctoken",
  identityKeys: "identity-key"
};

module.exports = {
  // Tudo numa transação: uma falha no meio não pode deixar tabelas criadas e
  // sessões já reescritas com a migration marcada como não aplicada.
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.createTable(
        "BaileysKeys",
        {
          whatsappId: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            references: { model: "Whatsapps", key: "id" },
            onUpdate: "CASCADE",
            onDelete: "CASCADE"
          },
          type: { type: DataTypes.STRING, primaryKey: true },
          keyId: { type: DataTypes.STRING, primaryKey: true },
          value: { type: DataTypes.TEXT, allowNull: false },
          createdAt: { type: DataTypes.DATE, allowNull: false },
          updatedAt: { type: DataTypes.DATE, allowNull: false }
        },
        { transaction }
      );
      // Backup para rollback, fora de Whatsapps para não ser carregado pelo modelo.
      await queryInterface.createTable(
        "WhatsappSessionBackups",
        {
          whatsappId: { type: DataTypes.INTEGER, primaryKey: true },
          session: { type: DataTypes.TEXT, allowNull: false },
          createdAt: { type: DataTypes.DATE, allowNull: false }
        },
        { transaction }
      );

      const whatsapps: { id: number; session: string | null }[] = await queryInterface.sequelize.query(
        `SELECT id, session FROM "Whatsapps" WHERE session IS NOT NULL AND session <> ''`,
        { type: QueryTypes.SELECT, transaction }
      );
      const now = new Date();
      for (const w of whatsapps) {
        let parsed: any;
        try {
          parsed = JSON.parse(w.session as string);
        } catch (e) {
          continue; // sessão ilegível: fica como está (o comportamento anterior não mudava)
        }
        const rows: any[] = [];
        const keys = parsed?.keys || {};
        for (const legacy of Object.keys(keys)) {
          const type = LEGACY_MAP[legacy];
          if (!type) continue;
          for (const keyId of Object.keys(keys[legacy] || {})) {
            const value = keys[legacy][keyId];
            if (value === null || value === undefined) continue;
            rows.push({ whatsappId: w.id, type, keyId, value: JSON.stringify(value), createdAt: now, updatedAt: now });
          }
        }
        for (let i = 0; i < rows.length; i += 500) {
          await queryInterface.bulkInsert("BaileysKeys", rows.slice(i, i + 500), { transaction });
        }
        await queryInterface.bulkInsert(
          "WhatsappSessionBackups",
          [{ whatsappId: w.id, session: w.session, createdAt: now }],
          { transaction }
        );
        await queryInterface.sequelize.query(`UPDATE "Whatsapps" SET session = :creds WHERE id = :id`, {
          replacements: { id: w.id, creds: JSON.stringify({ creds: parsed?.creds || null }) },
          transaction
        });
      }
    });
  },

  // Restaura o JSON de antes da migration em TODAS as conexões com backup,
  // inclusive as pareadas de novo depois dela (essas vão pedir QR outra vez).
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "Whatsapps" w SET session = b.session FROM "WhatsappSessionBackups" b WHERE b."whatsappId" = w.id`
    );
    await queryInterface.dropTable("WhatsappSessionBackups");
    await queryInterface.dropTable("BaileysKeys");
  }
};
