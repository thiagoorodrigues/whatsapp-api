import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import Whatsapp from "./Whatsapp";

// A contact WhatsApp sent to a connection (see the migration).
@Table({ tableName: "WhatsappContacts" })
class WhatsappContact extends Model<WhatsappContact> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Column
  jid: string;

  @Column
  lid: string | null;

  /** Phone digits, when known. */
  @Column
  number: string | null;

  /** Name saved in the phone's address book. */
  @Column
  name: string | null;

  /** Name the person set on their WhatsApp profile. */
  @Column
  notify: string | null;

  @Column
  verifiedName: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WhatsappContact;
