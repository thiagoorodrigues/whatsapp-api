import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Funnel from "./Funnel";

export type StageKind = "open" | "won" | "lost";

@Table({ tableName: "FunnelStages" })
class FunnelStage extends Model<FunnelStage> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => Funnel)
  @Column
  funnelId: number;

  @BelongsTo(() => Funnel)
  funnel: Funnel;

  @AllowNull(false)
  @Column
  name: string;

  @Default("#64748B")
  @Column
  color: string;

  @Default(0)
  @Column
  position: number;

  @Default("open")
  @Column(DataType.STRING(8))
  kind: StageKind;

  @Default(false)
  @Column
  archived: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelStage;
