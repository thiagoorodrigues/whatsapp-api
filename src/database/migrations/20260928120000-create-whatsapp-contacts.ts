import { QueryInterface, DataTypes } from "sequelize";

// Contacts WhatsApp sends to a connection (address book names, profile
// names). Used to show names in group mentions and by "Importar contatos";
// never listed as platform contacts.
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("WhatsappContacts", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      whatsappId: {
        type: DataTypes.INTEGER,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      jid: { type: DataTypes.STRING, allowNull: false },
      lid: { type: DataTypes.STRING, allowNull: true },
      number: { type: DataTypes.STRING, allowNull: true },
      name: { type: DataTypes.STRING, allowNull: true },
      notify: { type: DataTypes.STRING, allowNull: true },
      verifiedName: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("WhatsappContacts", ["whatsappId", "jid"], {
      unique: true,
      name: "whatsapp_contacts_whatsapp_jid"
    });
    await queryInterface.addIndex("WhatsappContacts", ["companyId", "number"], { name: "whatsapp_contacts_company_number" });
    await queryInterface.addIndex("WhatsappContacts", ["companyId", "lid"], { name: "whatsapp_contacts_company_lid" });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("WhatsappContacts");
  }
};
