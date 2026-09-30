import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  AllowNull, Default, ForeignKey, BelongsTo, DataType, HasMany
} from "sequelize-typescript";
import Company from "./Company";
import Funnel from "./Funnel";
import FunnelStage, { StageKind } from "./FunnelStage";
import Contact from "./Contact";
import User from "./User";
import LossReason from "./LossReason";
import DealEvent from "./DealEvent";

export type DealStatus = StageKind;

@Table({ tableName: "Deals" })
class Deal extends Model<Deal> {
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

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  userId: number | null;

  @BelongsTo(() => User)
  user: User;

  @AllowNull(false)
  @Column
  title: string;

  // DECIMAL comes back from Postgres as a string; callers convert with Number().
  @Default(0)
  @Column(DataType.DECIMAL(12, 2))
  value: string;

  @Column(DataType.DATEONLY)
  expectedCloseDate: string | null;

  @Column(DataType.STRING(16))
  source: string | null;

  @Column(DataType.TEXT)
  notes: string | null;

  @Default("open")
  @Column(DataType.STRING(8))
  status: DealStatus;

  @ForeignKey(() => LossReason)
  @Column(DataType.INTEGER)
  lossReasonId: number | null;

  @BelongsTo(() => LossReason)
  lossReason: LossReason;

  @Column(DataType.STRING)
  lossNote: string | null;

  @Default(0)
  @Column(DataType.DOUBLE)
  position: number;

  @AllowNull(false)
  @Column
  stageEnteredAt: Date;

  @Column(DataType.DATE)
  closedAt: Date | null;

  @HasMany(() => DealEvent)
  events: DealEvent[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Deal;
