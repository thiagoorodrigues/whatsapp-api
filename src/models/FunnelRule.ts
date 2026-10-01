import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Funnel from "./Funnel";
import FunnelStage from "./FunnelStage";
import Whatsapp from "./Whatsapp";
import Queue from "./Queue";

// Creates deals automatically when a contact writes in or enters a queue.
@Table({ tableName: "FunnelRules" })
class FunnelRule extends Model<FunnelRule> {
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

  @ForeignKey(() => FunnelStage)
  @Column
  stageId: number;

  @BelongsTo(() => FunnelStage)
  stage: FunnelStage;

  @ForeignKey(() => Whatsapp)
  @Column(DataType.INTEGER)
  whatsappId: number | null;

  @ForeignKey(() => Queue)
  @Column(DataType.INTEGER)
  queueId: number | null;

  @Default(true)
  @Column
  active: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelRule;
