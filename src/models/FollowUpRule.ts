import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, HasMany, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Whatsapp from "./Whatsapp";
import Queue from "./Queue";
import AiAgent from "./AiAgent";
import FollowUpStep from "./FollowUpStep";

export interface FollowUpFinalActions {
  closeTicket?: boolean;
  tagId?: number | null;
}

// A sequence of messages sent while the customer does not answer.
@Table({ tableName: "FollowUpRules" })
class FollowUpRule extends Model<FollowUpRule> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Column
  name: string;

  @Default(true)
  @Column
  active: boolean;

  @Default("no_reply")
  @Column
  trigger: string;

  @ForeignKey(() => Whatsapp)
  @Column(DataType.INTEGER)
  whatsappId: number | null;

  @ForeignKey(() => Queue)
  @Column(DataType.INTEGER)
  queueId: number | null;

  @Default(true)
  @Column
  respectBusinessHours: boolean;

  @Default({})
  @Column(DataType.JSONB)
  finalActions: FollowUpFinalActions;

  @ForeignKey(() => AiAgent)
  @Column(DataType.INTEGER)
  aiAgentId: number | null;

  @BelongsTo(() => AiAgent)
  aiAgent: AiAgent;

  @HasMany(() => FollowUpStep, { foreignKey: "ruleId", as: "steps", onDelete: "CASCADE" })
  steps: FollowUpStep[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FollowUpRule;
