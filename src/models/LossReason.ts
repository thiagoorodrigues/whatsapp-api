import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey
} from "sequelize-typescript";
import Company from "./Company";

@Table({ tableName: "LossReasons" })
class LossReason extends Model<LossReason> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @AllowNull(false)
  @Column
  name: string;

  @Default(true)
  @Column
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default LossReason;
