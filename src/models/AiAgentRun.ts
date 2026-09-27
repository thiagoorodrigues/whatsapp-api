import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  Default,
  DataType,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";
import AiAgent from "./AiAgent";
import Ticket from "./Ticket";

// One agent reply (with the tools it called), for auditing and cost.
@Table({ tableName: "AiAgentRuns" })
class AiAgentRun extends Model<AiAgentRun> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => AiAgent)
  @Column
  agentId: number;

  @BelongsTo(() => AiAgent)
  agent: AiAgent;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number | null;

  @Column
  provider: string;

  @Column
  model: string;

  @Default(0)
  @Column
  inputTokens: number;

  @Default(0)
  @Column
  outputTokens: number;

  @Default([])
  @Column({ type: DataType.JSONB })
  toolCalls: unknown[];

  @Column(DataType.TEXT)
  reply: string | null;

  @Column(DataType.TEXT)
  error: string | null;

  @Default(0)
  @Column
  durationMs: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AiAgentRun;
