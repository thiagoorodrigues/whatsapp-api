import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey, BelongsTo, HasMany, BelongsToMany
} from "sequelize-typescript";
import Company from "./Company";
import Queue from "./Queue";
import FunnelStage from "./FunnelStage";
import FunnelQueue from "./FunnelQueue";

@Table({ tableName: "Funnels" })
class Funnel extends Model<Funnel> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @AllowNull(false)
  @Column
  name: string;

  @Default("#2070F8")
  @Column
  color: string;

  @Default(0)
  @Column
  position: number;

  // Sellers see only their own deals and the unassigned ones.
  @Default(false)
  @Column
  ownDealsOnly: boolean;

  @Default(false)
  @Column
  archived: boolean;

  @HasMany(() => FunnelStage)
  stages: FunnelStage[];

  @BelongsToMany(() => Queue, () => FunnelQueue)
  queues: Queue[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Funnel;
