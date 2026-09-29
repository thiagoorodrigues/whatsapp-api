import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  ForeignKey,
  DataType
} from "sequelize-typescript";
import { Op } from "sequelize";
import Whatsapp from "./Whatsapp";
import { KeyRepo, KeyRow, parseKey } from "../helpers/baileysKeyStore";

// Uma linha por chave de sinal do Baileys (pre-key, session, sender-key, ...).
@Table({ tableName: "BaileysKeys" })
class BaileysKey extends Model<BaileysKey> {
  @PrimaryKey
  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @PrimaryKey
  @Column
  type: string;

  @PrimaryKey
  @Column
  keyId: string;

  @Column(DataType.TEXT)
  value: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export const sequelizeKeyRepo = (whatsappId: number): KeyRepo => ({
  async find(type, ids) {
    const rows = await BaileysKey.findAll({
      where: { whatsappId, type, keyId: { [Op.in]: ids } },
      attributes: ["type", "keyId", "value"]
    });
    return rows.map(r => ({ type: r.type, keyId: r.keyId, value: r.value }));
  },
  async upsert(rows: KeyRow[]) {
    const now = new Date();
    await BaileysKey.bulkCreate(
      rows.map(r => ({ whatsappId, ...r, createdAt: now, updatedAt: now })) as any,
      { updateOnDuplicate: ["value", "updatedAt"] }
    );
  },
  async remove(type, ids) {
    await BaileysKey.destroy({ where: { whatsappId, type, keyId: { [Op.in]: ids } } });
  }
});

export const clearBaileysKeys = async (whatsappId: number): Promise<void> => {
  await BaileysKey.destroy({ where: { whatsappId } });
};

export const readKeysOfType = async (
  whatsappId: number,
  type: string
): Promise<{ [id: string]: unknown }> => {
  const rows = await BaileysKey.findAll({ where: { whatsappId, type }, attributes: ["keyId", "value"] });
  const out: { [id: string]: unknown } = {};
  rows.forEach(r => {
    out[r.keyId] = parseKey(r.value);
  });
  return out;
};

export default BaileysKey;
