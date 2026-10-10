import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  DefaultScope
} from "sequelize-typescript";
import Company from "./Company";

// The token never leaves the API: read it with CompanyIntegration.unscoped().
@DefaultScope(() => ({ attributes: { exclude: ["tokenEncrypted"] } }))
@Table({ tableName: "CompanyIntegrations" })
class CompanyIntegration extends Model<CompanyIntegration> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  provider: string;

  @Column(DataType.TEXT)
  tokenEncrypted: string;

  @Column
  tokenHint: string;

  @Column
  status: string;

  @Column
  lastCheckedAt: Date;

  @Column
  lastError: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CompanyIntegration;
