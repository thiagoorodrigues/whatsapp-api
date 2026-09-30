import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Deal from "./Deal";
import User from "./User";

export type DealEventType =
  | "created" | "stage_changed" | "owner_changed" | "won" | "lost" | "reopened" | "edited";

@Table({ tableName: "DealEvents" })
class DealEvent extends Model<DealEvent> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => Deal)
  @Column
  dealId: number;

  @BelongsTo(() => Deal)
  deal: Deal;

  // Null when the system (an automatic rule) did it.
  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  userId: number | null;

  @BelongsTo(() => User)
  user: User;

  @AllowNull(false)
  @Column(DataType.STRING(16))
  type: DealEventType;

  @Column(DataType.STRING)
  fromValue: string | null;

  @Column(DataType.STRING)
  toValue: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default DealEvent;
